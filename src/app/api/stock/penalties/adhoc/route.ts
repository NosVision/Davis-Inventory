import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logHrAudit } from '@/lib/hr/audit';

// POST /api/stock/penalties/adhoc  { store_id, period_month: 'YYYY-MM', user_id, reason, amount }
// Ad-hoc SV (Service Charge) deduction outside the SOP engine (owner ask 2026-07-09): HQ docks a
// person's SC allocation by an arbitrary baht amount with a free-text reason. Mirrors the manual
// deduction shape from /api/hr/service-charge/allocations/[allocId]/deductions. `amount` is baht;
// it is stored as satang. HQ-only (can_manage_stock_sop / owner / hq). The month's SC pool must
// exist and not be finalized, and the person must already have an allocation in that pool.

const SC_POOLS = 'hr_sc_pools';
const SC_ALLOCS = 'hr_sc_allocations';
const SC_DEDUCTIONS = 'hr_sc_deductions';

async function requireStockSopManager(): Promise<
  { ok: true; userId: string } | { ok: false; res: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const service = createServiceClient();
  const [profileRes, permsRes] = await Promise.all([
    service.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    service.from('user_permissions').select('permission').eq('user_id', user.id),
  ]);
  const role = (profileRes.data as { role?: string } | null)?.role ?? '';
  const perms = (permsRes.data ?? []).map((p) => (p as { permission: string }).permission);
  if (role !== 'owner' && role !== 'hq' && !perms.includes('can_manage_stock_sop')) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, userId: user.id };
}

export async function POST(req: NextRequest) {
  const auth = await requireStockSopManager();
  if (!auth.ok) return auth.res;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const rawMonth = typeof body.period_month === 'string' ? body.period_month : '';
  const userId = typeof body.user_id === 'string' ? body.user_id : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const amount = Number(body.amount);

  if (!storeId || !rawMonth || !userId) {
    return NextResponse.json({ error: 'store_id, period_month, user_id required' }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: 'reason is required' }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be greater than 0' }, { status: 400 });
  }

  const monthYear = rawMonth.slice(0, 7); // 'YYYY-MM'
  const periodMonth = `${monthYear}-01`; // 'YYYY-MM-01' — hr_sc_pools.period_month

  const service = createServiceClient();

  // The month's SC pool for this store must exist and not be finalized.
  const { data: pool } = await service
    .from(SC_POOLS)
    .select('id, status')
    .eq('store_id', storeId)
    .eq('period_month', periodMonth)
    .maybeSingle();
  if (!pool) {
    return NextResponse.json({ error: 'ยังไม่มีกอง SC ของเดือนนี้' }, { status: 409 });
  }
  if ((pool as { status: string }).status === 'finalized') {
    return NextResponse.json({ error: 'กอง SC เดือนนี้ปิดรอบแล้ว แก้ไขไม่ได้' }, { status: 409 });
  }
  const poolId = (pool as { id: string }).id;

  // The person must already have an allocation in that pool.
  const { data: alloc } = await service
    .from(SC_ALLOCS)
    .select('id')
    .eq('pool_id', poolId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!alloc) {
    return NextResponse.json({ error: 'พนักงานยังไม่มียอด SC เดือนนี้' }, { status: 409 });
  }
  const allocId = (alloc as { id: string }).id;

  const { data, error } = await service
    .from(SC_DEDUCTIONS)
    .insert({
      allocation_id: allocId,
      source_type: 'manual',
      label: reason,
      amount_satang: Math.round(amount * 100),
      note: 'ad-hoc (HQ stock)',
      auto: false,
      created_by: auth.userId,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: SC_DEDUCTIONS,
    recordId: data.id as string,
    before: null,
    after: data,
    reason: `ad-hoc (HQ stock): ${reason}`,
  });

  return NextResponse.json({ ok: true });
}
