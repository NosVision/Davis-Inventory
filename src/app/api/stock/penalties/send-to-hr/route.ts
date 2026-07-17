import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyUser } from '@/lib/notifications/service';

// Stock fines → HR deduction hand-off (owner ask 2026-07-09; preview+select 2026-07-17).
//   GET  — preview WHO will be charged this store/month (grouped by staff) before sending.
//   POST — mark this store/month's pending money fines as 'sent_hr'. Optionally limited to a
//          selected set of penalty_ids so HQ can exclude some people. HR then decides on
//          /hr/stock-deductions whether to deduct now or defer.
// HQ-only (can_manage_stock_sop / owner / hq).

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

interface PendingRow {
  id: string;
  staff_id: string;
  penalty_code: string | null;
  reason: string | null;
  amount: number | null;
  business_date: string | null;
}

// GET /api/stock/penalties/send-to-hr?store_id=…&month=YYYY-MM
// Full (uncapped) list of this store/month's pending money fines, grouped by staff, so HQ can review
// exactly who will be charged and how much before sending — and untick anyone they want to exclude.
export async function GET(req: NextRequest) {
  const auth = await requireStockSopManager();
  if (!auth.ok) return auth.res;

  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get('store_id') ?? '';
  const month = (searchParams.get('month') ?? '').slice(0, 7);
  if (!storeId || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'store_id and month (YYYY-MM) required' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: penRows } = await service
    .from('penalties')
    .select('id, staff_id, penalty_code, reason, amount, business_date')
    .eq('store_id', storeId)
    .eq('month_year', month)
    .eq('status', 'pending')
    .gt('amount', 0)
    .order('business_date', { ascending: true });
  const rows = (penRows ?? []) as PendingRow[];

  const staffIds = [...new Set(rows.map((r) => r.staff_id).filter(Boolean))];
  const nameById = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data: profiles } = await service
      .from('profiles')
      .select('id, username, display_name')
      .in('id', staffIds);
    for (const p of (profiles ?? []) as { id: string; username: string | null; display_name: string | null }[]) {
      nameById.set(p.id, p.display_name || p.username || '—');
    }
  }

  // Who actually worked the audited business date(s) — schedule first, then real check-ins. This is
  // the owner rule (only the shift that was on is liable). We surface it so the review sheet can
  // PRE-TICK just the on-shift people; when there is no shift data at all we leave everyone tickable.
  const dates = [...new Set(rows.map((r) => r.business_date).filter((d): d is string => !!d))];
  const onShiftKeys = new Set<string>(); // `${staff_id}|${business_date}`
  let shiftDataAvailable = false;
  if (dates.length > 0 && staffIds.length > 0) {
    const { data: sched } = await service
      .from('hr_schedule')
      .select('user_id, work_date')
      .eq('store_id', storeId)
      .in('work_date', dates)
      .eq('is_day_off', false)
      .in('user_id', staffIds);
    for (const s of (sched ?? []) as { user_id: string; work_date: string }[]) {
      onShiftKeys.add(`${s.user_id}|${s.work_date}`);
      shiftDataAvailable = true;
    }
    const { data: att } = await service
      .from('hr_attendance')
      .select('user_id, business_date')
      .eq('store_id', storeId)
      .in('business_date', dates)
      .in('user_id', staffIds);
    for (const a of (att ?? []) as { user_id: string; business_date: string }[]) {
      onShiftKeys.add(`${a.user_id}|${a.business_date}`);
      shiftDataAvailable = true;
    }
  }

  // Group by staff (one card per person, with their fine breakdown + subtotal + on-shift flag).
  const groupMap = new Map<
    string,
    {
      staff_id: string;
      staff_name: string;
      total: number;
      on_shift: boolean;
      ids: string[];
      items: { code: string | null; amount: number; business_date: string | null }[];
    }
  >();
  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    const g = groupMap.get(r.staff_id) ?? {
      staff_id: r.staff_id,
      staff_name: nameById.get(r.staff_id) ?? '—',
      total: 0,
      on_shift: false,
      ids: [],
      items: [],
    };
    g.total += amt;
    g.ids.push(r.id);
    g.items.push({ code: r.penalty_code, amount: amt, business_date: r.business_date });
    if (r.business_date && onShiftKeys.has(`${r.staff_id}|${r.business_date}`)) g.on_shift = true;
    groupMap.set(r.staff_id, g);
  }
  const staff = [...groupMap.values()].sort((a, b) => a.staff_name.localeCompare(b.staff_name, 'th'));
  const totalBaht = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return NextResponse.json({
    data: { staff, total_count: rows.length, total_baht: totalBaht, shift_data_available: shiftDataAvailable },
  });
}

// POST /api/stock/penalties/send-to-hr  { store_id, month: 'YYYY-MM', penalty_ids?: string[] }
// Marks pending money penalties (amount > 0) as 'sent_hr'. When penalty_ids is provided, only those
// (still-pending, still-in this store/month) are sent — letting HQ exclude some people.
export async function POST(req: NextRequest) {
  const auth = await requireStockSopManager();
  if (!auth.ok) return auth.res;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const month = typeof body.month === 'string' ? body.month.slice(0, 7) : '';
  if (!storeId || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'store_id and month (YYYY-MM) required' }, { status: 400 });
  }

  // Optional explicit selection. Absent → send everything pending (backward compatible).
  const hasSelection = Array.isArray(body.penalty_ids);
  const penaltyIds = hasSelection
    ? (body.penalty_ids as unknown[]).filter((v): v is string => typeof v === 'string')
    : null;
  if (hasSelection && (penaltyIds?.length ?? 0) === 0) {
    return NextResponse.json({ error: 'กรุณาเลือกอย่างน้อย 1 รายการ' }, { status: 400 });
  }

  const service = createServiceClient();

  // Mark this store/month's not-yet-sent money fines as sent_hr (server re-checks status/amount so a
  // stale selected id can never send a non-pending row).
  let q = service
    .from('penalties')
    .update({ status: 'sent_hr' })
    .eq('store_id', storeId)
    .eq('month_year', month)
    .eq('status', 'pending')
    .gt('amount', 0);
  if (penaltyIds) q = q.in('id', penaltyIds);
  const { data: updated, error } = await q.select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const sent = (updated ?? []).length;
  if (sent === 0) {
    return NextResponse.json({ data: { sent: 0, note: 'no pending money fines to send' } });
  }

  // Notify HR (owner + hr) that a store/month's fines are ready to deduct.
  const { data: store } = await service.from('stores').select('store_name').eq('id', storeId).maybeSingle();
  const storeName = (store as { store_name?: string } | null)?.store_name ?? '';
  const { data: hrUsers } = await service.from('profiles').select('id').in('role', ['owner', 'hr']);
  await Promise.all(
    (hrUsers ?? []).map((u) =>
      notifyUser({
        userId: (u as { id: string }).id,
        storeId,
        type: 'approval_request',
        title: '💸 มีค่าปรับสต๊อกรอหัก SV',
        body: `${storeName} เดือน ${month} — ${sent} รายการ รอ HR พิจารณาหักจากกอง SV`,
        data: { url: '/hr/stock-deductions' },
      }).catch(() => {})
    )
  );

  return NextResponse.json({ data: { sent } });
}
