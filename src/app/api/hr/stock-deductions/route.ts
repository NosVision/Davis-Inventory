import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { buildEmployeeNameMap } from '@/lib/hr/employee-name-map';
import { payMonthOf, scPoolMonthForEvent } from '@/lib/hr/pay-cycle';

// GET /api/hr/stock-deductions — HR queue of stock fines HQ has forwarded (status 'sent_hr') for
// deduction from Service Charge (owner ask 2026-07-09). Grouped by store + PAYROLL CYCLE with
// per-person totals, plus whether the pool that cycle docks already exists (so HR knows it can
// deduct now or must defer). HR then POSTs /api/hr/service-charge/apply-stock-penalties.
//
// Grouped on the cycle a fine's business_date falls in, not on its month_year tag: since
// 2026-08-24 every SV deduction is measured on the payroll cycle, and a fine dated the 28th
// belongs to the cycle that opened on the 26th. The pool it reaches is the one paid a month after
// that cycle closes. It used to be the pool of the fine's OWN month — already transferred on the
// 15th — so a fine either docked paid-out money or, once that pool was finalized, could never be
// applied at all.
export async function GET() {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();

  const { data: pen, error } = await service
    .from('penalties')
    .select('store_id, month_year, business_date, staff_id, amount')
    .eq('status', 'sent_hr')
    .gt('amount', 0);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const raw = (pen ?? []) as { store_id: string; month_year: string; business_date: string | null; staff_id: string; amount: number | null }[];
  // business_date is the fine's real day; month_year is only a label. Any row written before
  // business_date existed falls back to it rather than dropping out of the queue.
  const rows = raw.map((r) => ({ ...r, cycle: r.business_date ? payMonthOf(r.business_date) : r.month_year }));

  // Resolve store + staff names, and whether the pool each cycle docks already exists.
  const storeIds = [...new Set(rows.map((r) => r.store_id))];
  const staffIds = [...new Set(rows.map((r) => r.staff_id))];
  const months = [...new Set(rows.map((r) => scPoolMonthForEvent(r.cycle)))];
  const [storesRes, staffName, poolsRes] = await Promise.all([
    storeIds.length ? service.from('stores').select('id, store_name').in('id', storeIds) : Promise.resolve({ data: [] }),
    // ชื่อจริง (ชื่อเล่น) — these deductions land on a payslip, so they name the person the same way.
    buildEmployeeNameMap(service, staffIds),
    storeIds.length ? service.from('hr_sc_pools').select('store_id, period_month, status').in('store_id', storeIds).in('period_month', months) : Promise.resolve({ data: [] }),
  ]);
  const storeName = new Map((storesRes.data ?? []).map((s) => [(s as { id: string }).id, (s as { store_name: string }).store_name]));
  const poolByKey = new Map(
    (poolsRes.data ?? []).map((p) => [`${(p as { store_id: string }).store_id}|${(p as { period_month: string }).period_month}`, (p as { status: string }).status])
  );

  // Group by (store, payroll cycle) → per-person totals.
  type Person = { staff_id: string; name: string; nickname: string | null; baht: number; count: number };
  type Group = { key: string; store_id: string; store_name: string; month: string; total_baht: number; count: number; pool_status: string | null; people: Person[] };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.store_id}|${r.cycle}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        store_id: r.store_id,
        store_name: storeName.get(r.store_id) ?? '—',
        month: r.cycle,
        total_baht: 0,
        count: 0,
        pool_status: poolByKey.get(`${r.store_id}|${scPoolMonthForEvent(r.cycle)}`) ?? null,
        people: [],
      };
      groups.set(key, g);
    }
    const baht = Number(r.amount) || 0;
    g.total_baht += baht;
    g.count += 1;
    let person = g.people.find((p) => p.staff_id === r.staff_id);
    if (!person) {
      person = {
        staff_id: r.staff_id,
        name: staffName.get(r.staff_id)?.name ?? '—',
        nickname: staffName.get(r.staff_id)?.nickname ?? null,
        baht: 0,
        count: 0,
      };
      g.people.push(person);
    }
    person.baht += baht;
    person.count += 1;
  }
  const list = [...groups.values()].sort((a, b) => b.month.localeCompare(a.month) || a.store_name.localeCompare(b.store_name));

  return NextResponse.json({ data: { groups: list } });
}
