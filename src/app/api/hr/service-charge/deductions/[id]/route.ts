import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const POOLS = 'hr_sc_pools';
const ALLOCS = 'hr_sc_allocations';
const DEDUCTIONS = 'hr_sc_deductions';

// DELETE /api/hr/service-charge/deductions/[id] — remove a MANUAL deduction line (§H).
// Auto-computed lines are owned by recompute and must not be deleted directly; a finalized
// pool is locked.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: deduction, error: fetchErr } = await service
    .from(DEDUCTIONS)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!deduction) return NextResponse.json({ error: 'Deduction not found' }, { status: 404 });

  // §P5.5: resolve the pool's store (deduction → allocation → pool) and gate before deleting.
  const { data: alloc } = await service
    .from(ALLOCS)
    .select('id, pool_id')
    .eq('id', deduction.allocation_id as string)
    .maybeSingle();
  const { data: pool } = alloc
    ? await service.from(POOLS).select('id, status, store_id').eq('id', alloc.pool_id).maybeSingle()
    : { data: null };
  const auth = await requireHrManagerForStore((pool?.store_id as string | undefined) ?? null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (deduction.auto === true) {
    return NextResponse.json(
      { error: 'auto-computed deductions are managed by recompute, not deletable directly' },
      { status: 400 },
    );
  }
  if (pool && pool.status === 'finalized') {
    return NextResponse.json({ error: 'pool is finalized' }, { status: 409 });
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
