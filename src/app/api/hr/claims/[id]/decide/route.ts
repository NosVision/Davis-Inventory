import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_claims';

// POST /api/hr/claims/[id]/decide — a manager/HR approves or rejects a pending expense
// claim (§J2). The status transition is an atomic compare-and-set (`.eq('status','pending')`,
// 0 rows → 409) so a decide racing a concurrent cancel/decide can never clobber an
// already-decided row. There is NO side-effect apply here: an approved claim becomes a
// payslip earning in P4 — this route only records the decision.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(TABLE)
    .select('id, store_id, status, user_id, claim_type, amount_satang')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load claim' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

  const auth = row.store_id
    ? await requireStoreManager(row.store_id as string)
    : await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if ((row.status as string) !== 'pending') {
    return NextResponse.json({ error: 'Only pending claims can be decided' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }

  const decidedAt = new Date().toISOString();

  // Atomic compare-and-set: only flip a row that is STILL pending. No side-effect apply —
  // the payslip earning is created in P4.
  const { data: updated, error } = await service
    .from(TABLE)
    .update({
      status: decision,
      approver_id: auth.userId,
      decided_at: decidedAt,
      decision_note: note,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to decide claim' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Already decided' }, { status: 409 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    before: { status: 'pending' },
    after: { status: decision, decision_note: note },
    reason: note ?? undefined,
  });

  return NextResponse.json({ data: { id, status: decision } });
}
