import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_claims';

// POST /api/hr/ess/claims/[id]/cancel — the claimant withdraws their OWN still-pending
// expense claim (§J2). Auth-any, but ownership is enforced: only the claimant may
// cancel, and only while the claim is pending (not after a decision).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(TABLE)
    .select('id, user_id, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load claim' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  if ((row.user_id as string) !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Atomic compare-and-set: only flip a row that is STILL pending. Without the status
  // predicate a cancel racing a concurrent approve/reject would clobber a decided row.
  const { data: updated, error } = await service
    .from(TABLE)
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to cancel claim' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Already decided or not cancellable' }, { status: 409 });
  }

  // The receipt file is intentionally retained as part of the audit trail.
  await logHrAudit(service, {
    actorId: user.id,
    action: 'update',
    table: TABLE,
    recordId: id,
    before: { status: 'pending' },
    after: { status: 'cancelled' },
    reason: 'employee cancelled claim',
  });

  return NextResponse.json({ data: { id, status: 'cancelled' } });
}
