import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const POOLS = 'hr_tip_pools';
const ALLOCS = 'hr_tip_allocations';
const DEDUCTIONS = 'hr_tip_deductions';

// DELETE /api/hr/tip-pool/deductions/[id] — remove a manual deduction line. A finalized pool
// is locked. (Tips have no auto lines, but the auto flag is honored defensively.)
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();

  const { data: deduction, error: fetchErr } = await service
    .from(DEDUCTIONS)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!deduction) return NextResponse.json({ error: 'Deduction not found' }, { status: 404 });

  if (deduction.auto === true) {
    return NextResponse.json(
      { error: 'auto-computed deductions are not deletable directly' },
      { status: 400 },
    );
  }

  const { data: alloc } = await service
    .from(ALLOCS)
    .select('id, pool_id')
    .eq('id', deduction.allocation_id as string)
    .maybeSingle();
  if (alloc) {
    const { data: pool } = await service
      .from(POOLS)
      .select('id, status')
      .eq('id', alloc.pool_id)
      .maybeSingle();
    if (pool && pool.status === 'finalized') {
      return NextResponse.json({ error: 'pool is finalized' }, { status: 409 });
    }
  }

  const { error } = await service.from(DEDUCTIONS).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'delete',
    table: DEDUCTIONS,
    recordId: id,
    before: deduction,
    after: null,
  });

  return NextResponse.json({ data: { id, removed: true } });
}
