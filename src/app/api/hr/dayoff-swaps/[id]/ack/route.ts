import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';

// POST /api/hr/dayoff-swaps/[id]/ack — company HR acknowledges an already-approved
// swap (§C, P2.3a). This is a payroll-side sign-off, NOT the approval, so it is
// gated on company-wide HR (requireHrManager), not the store manager. Only approved
// swaps can be acknowledged.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();

  const { data: swap, error: loadErr } = await service
    .from('hr_dayoff_swaps')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load swap' }, { status: 500 });
  if (!swap) return NextResponse.json({ error: 'Swap not found' }, { status: 404 });
  if ((swap.status as string) !== 'approved') {
    return NextResponse.json(
      { error: 'only approved swaps can be acknowledged' },
      { status: 409 }
    );
  }

  const ackedAt = new Date().toISOString();
  const { error } = await service
    .from('hr_dayoff_swaps')
    .update({ hr_acked_by: auth.userId, hr_acked_at: ackedAt })
    .eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to acknowledge swap' }, { status: 500 });

  return NextResponse.json({ data: { id, hr_acked_at: ackedAt } });
}
