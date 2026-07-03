import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { computeNetSc } from '@/lib/hr/service-charge';

const POOLS = 'hr_sc_pools';
const ALLOCS = 'hr_sc_allocations';
const MONTH_RE = /^\d{4}-\d{2}-01$/; // period_month must be the first of a month.

const ALLOC_SELECT =
  '*, employee:profiles!hr_sc_allocations_user_id_fkey(id, display_name, username), deductions:hr_sc_deductions(*)';

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

// GET /api/hr/service-charge?store_id&period_month=YYYY-MM-01 — the pool for a store/month
// plus its per-person allocations, each with its deduction lines and computed net SC (§H).
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = request.nextUrl.searchParams;
  const storeId = sp.get('store_id') ?? '';
  const periodMonth = sp.get('period_month') ?? '';
  if (!storeId || !MONTH_RE.test(periodMonth)) {
    return NextResponse.json(
      { error: 'store_id and a valid period_month (YYYY-MM-01) are required' },
      { status: 400 },
    );
  }

  const service = createServiceClient();

  const { data: pool, error: poolErr } = await service
    .from(POOLS)
    .select('*')
    .eq('store_id', storeId)
    .eq('period_month', periodMonth)
    .maybeSingle();
  if (poolErr) return NextResponse.json({ error: poolErr.message }, { status: 500 });
  if (!pool) return NextResponse.json({ data: null });

  const { data: rows, error: allocErr } = await service
    .from(ALLOCS)
    .select(ALLOC_SELECT)
    .eq('pool_id', pool.id)
    .order('created_at', { ascending: true });
  if (allocErr) return NextResponse.json({ error: allocErr.message }, { status: 500 });

  let allocated = 0;
  let net = 0;
  const allocations = (rows ?? []).map((row: Record<string, unknown>) => {
    const deductions = (row.deductions ?? []) as { amount_satang: number }[];
    const allocatedSatang = (row.allocated_satang as number) ?? 0;
    const netSatang = computeNetSc(allocatedSatang, deductions);
    allocated += allocatedSatang;
    net += netSatang;
    return { ...row, deductions, net_satang: netSatang };
  });

  return NextResponse.json({
    data: {
      pool,
      allocations,
      totals: { allocated, deducted: allocated - net, net },
    },
  });
}

// PUT /api/hr/service-charge — create or update the monthly SC pool for a store (§H).
// The total pool is entered manually per store/month. A finalized pool is locked.
export async function PUT(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const periodMonth = typeof body.period_month === 'string' ? body.period_month : '';
  const payDate = typeof body.pay_date === 'string' && body.pay_date ? body.pay_date : null;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null;

  if (!storeId || !MONTH_RE.test(periodMonth)) {
    return NextResponse.json(
      { error: 'store_id and a valid period_month (YYYY-MM-01) are required' },
      { status: 400 },
    );
  }
  if (!isNonNegInt(body.total_satang)) {
    return NextResponse.json({ error: 'total_satang must be a non-negative integer' }, { status: 400 });
  }
  const totalSatang = body.total_satang;

  const service = createServiceClient();

  // A finalized pool for this store/month is locked — never overwrite it.
  const { data: existing } = await service
    .from(POOLS)
    .select('*')
    .eq('store_id', storeId)
    .eq('period_month', periodMonth)
    .maybeSingle();
  if (existing && existing.status === 'finalized') {
    return NextResponse.json({ error: 'pool is finalized' }, { status: 409 });
  }

  const row = {
    store_id: storeId,
    period_month: periodMonth,
    total_satang: totalSatang,
    pay_date: payDate,
    notes,
    updated_by: auth.userId,
    created_by: existing ? (existing.created_by as string) ?? auth.userId : auth.userId,
  };

  const { data, error } = await service
    .from(POOLS)
    .upsert(row, { onConflict: 'store_id,period_month' })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: existing ? 'update' : 'create',
    table: POOLS,
    recordId: data.id as string,
    before: existing ?? null,
    after: data,
  });

  return NextResponse.json({ data });
}
