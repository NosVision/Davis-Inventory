import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';

// POST /api/hr/dayoff-swaps/[id]/decide — the store manager approves or rejects a
// pending swap (§C, P2.3a). Approval is delegated to the atomic RPC
// hr_approve_dayoff_swap, which re-checks the swap is pending and exchanges the two
// schedule cells transactionally; any stale/precondition failure surfaces as a
// generic 409 (never the raw Postgres RAISE text).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: swap, error: loadErr } = await service
    .from('hr_dayoff_swaps')
    .select('id, store_id, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load swap' }, { status: 500 });
  if (!swap) return NextResponse.json({ error: 'Swap not found' }, { status: 404 });

  const auth = await requireStoreManager(swap.store_id as string);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if ((swap.status as string) !== 'pending') {
    return NextResponse.json({ error: 'Only pending swaps can be decided' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  if (decision === 'approved') {
    const { error: rpcErr } = await service.rpc('hr_approve_dayoff_swap', {
      p_swap_id: id,
      p_approver: auth.userId,
    });
    // The RPC raises on any stale/missing schedule precondition — surface generically.
    if (rpcErr) return NextResponse.json({ error: 'Could not apply swap' }, { status: 409 });
    return NextResponse.json({ data: { id, status: 'approved' } });
  }

  if (decision === 'rejected') {
    // Atomic compare-and-set (only a still-pending row), so a reject racing a concurrent
    // approve can't overwrite the already-applied 'approved' row and orphan the swap.
    const { data: updated, error } = await service
      .from('hr_dayoff_swaps')
      .update({
        status: 'rejected',
        decided_by: auth.userId,
        decided_at: new Date().toISOString(),
        decision_note: note,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) return NextResponse.json({ error: 'Failed to reject swap' }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Swap was already decided' }, { status: 409 });
    }
    return NextResponse.json({ data: { id, status: 'rejected' } });
  }

  return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
}
