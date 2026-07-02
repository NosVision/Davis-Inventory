import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// POST /api/hr/ess/dayoff-swaps/[id]/cancel — the requester withdraws their OWN
// still-pending swap (§C, P2.3a). Auth-any, but ownership is enforced: only the
// requester may cancel, and only while the swap is pending (not after a decision).
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

  const { data: swap, error: loadErr } = await service
    .from('hr_dayoff_swaps')
    .select('id, requester_id, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load swap' }, { status: 500 });
  if (!swap) return NextResponse.json({ error: 'Swap not found' }, { status: 404 });
  if ((swap.requester_id as string) !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if ((swap.status as string) !== 'pending') {
    return NextResponse.json({ error: 'Only pending swaps can be cancelled' }, { status: 409 });
  }

  // Atomic compare-and-set: only flip a row that is STILL pending. Without the status
  // predicate a cancel racing a concurrent approve would clobber the already-applied
  // 'approved' row, desyncing the record from the schedule the approve RPC changed.
  const { data: updated, error } = await service
    .from('hr_dayoff_swaps')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to cancel swap' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Swap was already decided' }, { status: 409 });
  }

  return NextResponse.json({ data: { id, status: 'cancelled' } });
}
