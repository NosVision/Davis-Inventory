import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope } from '@/lib/hr/route-auth';

interface PendingRow {
  store_id: string;
  work_date: string;
}
interface PendingGroup {
  store_id: string;
  store_name: string;
  month: string;
  count: number;
}

// Cap the scan — the pending set (published-but-unacknowledged rosters) is normally a handful of
// store-months; this only guards against an unbounded backlog if acknowledgment is neglected.
const MAX_ROWS = 5000;

// GET /api/hr/schedule/pending — HR's acknowledge inbox (§C): every roster HR published
// (status='submitted') that still awaits their acknowledgment, grouped by store + month. Gated to
// HR (resolveHrScope): company-wide HR sees all stores, a scoped manager only their stores. The HQ
// scheduler role publishes but does not acknowledge, so it is intentionally denied here.
export async function GET() {
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const service = createServiceClient();

  let query = service
    .from('hr_schedule')
    .select('store_id, work_date')
    .eq('status', 'submitted')
    .limit(MAX_ROWS);
  // A store-scoped manager only sees their stores; company-wide HR (storeIds === null) sees all.
  if (scope.storeIds !== null) {
    if (scope.storeIds.length === 0) return NextResponse.json({ data: [] });
    query = query.in('store_id', scope.storeIds);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to load pending schedules' }, { status: 500 });
  const rows = (data ?? []) as PendingRow[];
  if (rows.length === 0) return NextResponse.json({ data: [] });

  // Collapse rows → one entry per (store, month) with an assignment count.
  const groups = new Map<string, { store_id: string; month: string; count: number }>();
  for (const r of rows) {
    const month = r.work_date.slice(0, 7);
    const key = `${r.store_id}|${month}`;
    const g = groups.get(key);
    if (g) g.count += 1;
    else groups.set(key, { store_id: r.store_id, month, count: 1 });
  }

  // Resolve store names for the distinct stores involved.
  const storeIds = [...new Set([...groups.values()].map((g) => g.store_id))];
  const { data: storesData, error: storesErr } = await service
    .from('stores')
    .select('id, store_name')
    .in('id', storeIds);
  if (storesErr) return NextResponse.json({ error: 'Failed to load stores' }, { status: 500 });
  const nameById = new Map((storesData ?? []).map((s) => [s.id as string, (s.store_name as string) ?? '—']));

  const result: PendingGroup[] = [...groups.values()]
    .map((g) => ({
      store_id: g.store_id,
      store_name: nameById.get(g.store_id) ?? '—',
      month: g.month,
      count: g.count,
    }))
    // Newest month first, then store name — HR works the current month down.
    .sort((a, b) => b.month.localeCompare(a.month) || a.store_name.localeCompare(b.store_name));

  return NextResponse.json({ data: result });
}
