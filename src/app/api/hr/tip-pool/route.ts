import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { payHiddenProfileIds } from '@/lib/hr/pay-visibility';
import { partitionPoolAllocations } from '@/lib/hr/pool-visibility';
import { refusePoolIfHidden } from '@/lib/hr/pool-access';

// Tip pool = same manual pool/allocation/deduction mechanism as Service Charge (00109 mirrors
// 00103). Net tip per person feeds the payslip 'tip' earning line (P4.4). All lines are manual
// (no auto-recompute), so net = allocated − Σ deductions.
const POOLS = 'hr_tip_pools';
const ALLOCS = 'hr_tip_allocations';
const MONTH_RE = /^\d{4}-\d{2}-01$/;

const ALLOC_SELECT =
  '*, employee:profiles!hr_tip_allocations_user_id_fkey(id, display_name, username), deductions:hr_tip_deductions(*)';

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function netTip(allocatedSatang: number, deductions: { amount_satang: number }[]): number {
  const ded = (deductions ?? []).reduce((s, d) => s + Math.max(0, d.amount_satang), 0);
  return Math.max(0, allocatedSatang - ded);
}

// GET /api/hr/tip-pool?store_id&period_month=YYYY-MM-01 — the tip pool for a store/month plus
// its per-person allocations, each with deduction lines and computed net tip. Allocations of people
// whose pay the caller may not see are withheld (pool-visibility.ts).
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeId = sp.get('store_id') ?? '';
  const periodMonth = sp.get('period_month') ?? '';
  if (!storeId || !MONTH_RE.test(periodMonth)) {
    return NextResponse.json(
      { error: 'store_id and a valid period_month (YYYY-MM-01) are required' },
      { status: 400 },
    );
  }

  // §P5.5: tip pool is per-store — only a manager of this store (or company-wide HR) may read it.
  const auth = await requireStoreManager(storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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

  const allocations = (rows ?? []).map((row: Record<string, unknown>) => {
    const deductions = (row.deductions ?? []) as { amount_satang: number }[];
    const allocatedSatang = (row.allocated_satang as number) ?? 0;
    return {
      ...row,
      user_id: row.user_id as string,
      allocated_satang: allocatedSatang,
      deductions,
      net_satang: netTip(allocatedSatang, deductions),
    };
  });
  const view = partitionPoolAllocations(allocations, await payHiddenProfileIds(service, auth.userId));

  return NextResponse.json({
    data: {
      // Same reasons as the SC pool: the total is a subtraction away from the hidden allocations, the
      // page must label partial figures, and one hidden person disables every action.
      pool: view.hiddenCount > 0 ? { ...pool, total_satang: null } : pool,
      allocations: view.allocations,
      totals: view.totals,
      hidden_count: view.hiddenCount,
      can_manage: view.hiddenCount === 0,
    },
  });
}

// PUT /api/hr/tip-pool — create or update the monthly tip pool for a store. Total is entered
// manually; a finalized pool is locked (compare-and-set on status='draft').
export async function PUT(request: NextRequest) {
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

  // §P5.5: tip pool is per-store — gate the write on this store.
  const auth = await requireStoreManager(storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();

  const { data: existing } = await service
    .from(POOLS)
    .select('*')
    .eq('store_id', storeId)
    .eq('period_month', periodMonth)
    .maybeSingle();
  if (existing) {
    const refusal = await refusePoolIfHidden(service, auth.userId, 'tip', [existing.id as string]);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
  }
  if (existing && existing.status === 'finalized') {
    return NextResponse.json({ error: 'pool is finalized' }, { status: 409 });
  }

  let data;
  if (existing) {
    const { data: updated, error } = await service
      .from(POOLS)
      .update({ total_satang: totalSatang, pay_date: payDate, notes, updated_by: auth.userId })
      .eq('id', existing.id)
      .eq('status', 'draft')
      .select('*')
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: 'pool is finalized' }, { status: 409 });
    data = updated;
  } else {
    const { data: inserted, error } = await service
      .from(POOLS)
      .insert({
        store_id: storeId,
        period_month: periodMonth,
        total_satang: totalSatang,
        pay_date: payDate,
        notes,
        created_by: auth.userId,
        updated_by: auth.userId,
      })
      .select('*')
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json({ error: 'pool already exists for this period' }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    data = inserted;
  }

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
