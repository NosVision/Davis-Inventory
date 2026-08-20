import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForRowStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { recomputeScForUserAt } from '@/lib/hr/sc-recompute';

const TABLE = 'hr_warnings';

// POST /api/hr/warnings/[id]/void — HR voids a warning. Body: { reason }. The status
// transition is an atomic compare-and-set (`status <> 'void'`, 0 rows → 409) so a void
// racing a concurrent void can never double-apply. Only company-wide HR may void.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireHrManagerForRowStore('hr_warnings', id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: 'A void reason is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: updated, error } = await service
    .from(TABLE)
    .update({ status: 'void', void_reason: reason, updated_by: auth.userId })
    .eq('id', id)
    .neq('status', 'void')
    .select('id, user_id, issued_at');
  if (error) return NextResponse.json({ error: 'Failed to void warning' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Warning not found or already voided' }, { status: 409 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    after: { status: 'void', void_reason: reason },
    reason,
  });

  // A voided warning must stop docking. The recompute rebuilds the pool's auto lines from the
  // warnings that still count, so the dock disappears the moment the void lands rather than at
  // whatever later point someone happened to press Recompute.
  const row = updated[0] as unknown as { user_id: string; issued_at: string | null };
  const scSync = await recomputeScForUserAt(service, row.user_id, row.issued_at, auth.userId);

  return NextResponse.json({ data: { id, status: 'void' }, sc_sync: scSync });
}
