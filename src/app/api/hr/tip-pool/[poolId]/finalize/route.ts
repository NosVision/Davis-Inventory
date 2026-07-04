import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const POOLS = 'hr_tip_pools';

// Tips follow the same pay cadence as SC: paid on the 15th of the month AFTER period_month.
function payDateFor(periodMonth: string): string {
  const [y, m] = periodMonth.split('-').map((n) => parseInt(n, 10));
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  return `${year}-${String(month).padStart(2, '0')}-15`;
}

// POST /api/hr/tip-pool/[poolId]/finalize — lock a draft pool (compare-and-set on status).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  const service = createServiceClient();

  const { data: before } = await service.from(POOLS).select('*').eq('id', poolId).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });

  // §P5.5: gate on the pool's store.
  const auth = await requireStoreManager(before.store_id as string);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const payDate = payDateFor(before.period_month as string);

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
    reason: 'tip pool finalized',
  });

  return NextResponse.json({ data: { id: poolId, status: 'finalized', pay_date: payDate } });
}
