import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { recomputePoolDeductions } from '@/lib/hr/sc-recompute';

const POOLS = 'hr_sc_pools';

// SC is paid on the 15th of the month AFTER the pool's period_month (§H).
// period_month is always the first of a month (YYYY-MM-01).
function payDateFor(periodMonth: string): string {
  const [y, m] = periodMonth.split('-').map((n) => parseInt(n, 10));
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  return `${year}-${String(month).padStart(2, '0')}-15`;
}

// POST /api/hr/service-charge/[poolId]/finalize — lock a draft pool (§H). Compare-and-set on
// status so a concurrent finalize can't double-run; sets pay_date to the 15th of next month.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  const service = createServiceClient();

  const { data: before } = await service
    .from(POOLS)
    .select('*')
    .eq('id', poolId)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });

  // §P5.5: gate on the pool's store.
  const auth = await requireStoreManager(before.store_id as string);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const payDate = payDateFor(before.period_month as string);

  // §H: recompute (pull the latest prior-month carry) + reconcile the shared-balance deferral one
  // last time while the pool is still editable, so the locked pool is always current and never
  // carries a silently-dropped overflow. (Skip if already finalized — the DB triggers block deduction
  // writes, and the compare-and-set below will 409.)
  if ((before.status as string) === 'draft') {
    try {
      await recomputePoolDeductions(service, poolId, auth.userId);
    } catch {
      // A concurrent finalize may have locked the pool mid-recompute (00104 triggers then block the
      // deduction writes). Re-check: if it's now finalized, that's a clean double-finalize → 409, not 500.
      const { data: cur } = await service.from(POOLS).select('status').eq('id', poolId).maybeSingle();
      if ((cur?.status as string | undefined) === 'finalized') {
        return NextResponse.json({ error: 'pool is already finalized' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to recompute deductions before finalize' }, { status: 500 });
    }
  }

  // Compare-and-set: only a draft pool can be finalized. 0 rows → already finalized.
  const { data, error } = await service
    .from(POOLS)
    .update({
      status: 'finalized',
      finalized_at: new Date().toISOString(),
      finalized_by: auth.userId,
      pay_date: payDate,
      updated_by: auth.userId,
    })
    .eq('id', poolId)
    .eq('status', 'draft')
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'pool is already finalized' }, { status: 409 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: POOLS,
    recordId: poolId,
    before,
    after: data,
    reason: 'pool finalized',
  });

  return NextResponse.json({ data: { id: poolId, status: 'finalized', pay_date: payDate } });
}
