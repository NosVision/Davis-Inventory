import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { buildEmployeeNameMap } from '@/lib/hr/employee-name-map';

// GET /api/hr/stock-deductions — HR queue of stock fines HQ has forwarded (status 'sent_hr') for
// deduction from Service Charge (owner ask 2026-07-09). Grouped by store + month with per-person
// totals, plus whether that month's SC pool exists (so HR knows it can deduct now or must defer).
// HR then POSTs /api/hr/service-charge/apply-stock-penalties to deduct, or leaves it to defer.
export async function GET() {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();

  const { data: pen, error } = await service
    .from('penalties')
    .select('store_id, month_year, staff_id, amount')
    .eq('status', 'sent_hr')
    .gt('amount', 0);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (pen ?? []) as { store_id: string; month_year: string; staff_id: string; amount: number | null }[];

  // Resolve store + staff names, and which (store, month) SC pools already exist.
  const storeIds = [...new Set(rows.map((r) => r.store_id))];
  const staffIds = [...new Set(rows.map((r) => r.staff_id))];
  const months = [...new Set(rows.map((r) => `${r.month_year}-01`))];
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

  // Group by (store, month) → per-person totals.
  type Person = { staff_id: string; name: string; nickname: string | null; baht: number; count: number };
  type Group = { key: string; store_id: string; store_name: string; month: string; total_baht: number; count: number; pool_status: string | null; people: Person[] };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.store_id}|${r.month_year}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        store_id: r.store_id,
        store_name: storeName.get(r.store_id) ?? '—',
        month: r.month_year,
        total_baht: 0,
        count: 0,
        pool_status: poolByKey.get(`${r.store_id}|${r.month_year}-01`) ?? null,
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
