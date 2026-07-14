import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { computeNetSc } from '@/lib/hr/service-charge';
import { recomputePoolDeductions } from '@/lib/hr/sc-recompute';

const POOL = 'hr_sc_pools';
const ALLOC = 'hr_sc_allocations';
const DED = 'hr_sc_deductions';

// POST /api/hr/service-charge/[poolId]/recompute — rebuild the AUTO (warning + leave + prior-month
// carry) SC deduction lines for a draft pool and reconcile the shared-balance deferral (§H). Manual
// and applied eval/stock-penalty lines are preserved. The heavy lifting lives in the reusable
// recomputePoolDeductions() so the same computation also runs automatically when allocations are
// saved and at finalize.
export async function POST(_request: Request, { params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  const service = createServiceClient();

  const { data: pool, error: poolErr } = await service
    .from(POOL)
    .select('id, store_id, period_month, status')
    .eq('id', poolId)
    .maybeSingle();
  if (poolErr) return NextResponse.json({ error: 'Failed to load pool' }, { status: 500 });
  if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });

  // §P5.5: gate on the pool's store.
  const auth = await requireStoreManager(pool.store_id as string);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if ((pool.status as string) === 'finalized') {
    return NextResponse.json({ error: 'Pool is finalized' }, { status: 409 });
  }

  try {
    await recomputePoolDeductions(service, poolId, auth.userId);
  } catch {
    return NextResponse.json({ error: 'Failed to recompute SC deductions' }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: POOL,
    recordId: poolId,
    reason: 'Recomputed auto SC deductions (warnings + leave + carry) + reconciled shared balance',
  });

  // Return the refreshed detail (allocations + deductions + net).
  const { data: freshAllocs } = await service
    .from(ALLOC)
    .select(
      'id, user_id, allocated_satang, employee:profiles!hr_sc_allocations_user_id_fkey(id, display_name, username)'
    )
    .eq('pool_id', poolId);

  const detail = [];
  let totAlloc = 0;
  let totDed = 0;
  let totNet = 0;
  for (const a of freshAllocs ?? []) {
    const { data: deds } = await service
      .from(DED)
      .select('id, source_type, source_ref, label, amount_satang, carry_satang, note, auto')
      .eq('allocation_id', a.id as string)
      .order('created_at', { ascending: true });
    const allocated = Number(a.allocated_satang) || 0;
    const net = computeNetSc(
      allocated,
      (deds ?? []).map((d) => ({ amount_satang: Number(d.amount_satang) || 0 }))
    );
    totAlloc += allocated;
    totDed += allocated - net;
    totNet += net;
    detail.push({ ...a, deductions: deds ?? [], net_satang: net });
  }

  return NextResponse.json({
    data: {
      pool,
      allocations: detail,
      totals: { allocated: totAlloc, deducted: totDed, net: totNet },
    },
  });
}
