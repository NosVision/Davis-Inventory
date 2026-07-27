import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireScheduler } from '@/lib/hr/route-auth';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CELLS = 3000; // ~100 staff × 31 days ceiling for one save

interface CellInput {
  user_id: string;
  work_date: string;
  shift_template_id: string | null;
  is_day_off: boolean;
  clear?: boolean;
}

// Roster scope — mirrors /api/hr/schedule: store mode (user_stores members) or company mode
// (hr_employees of that company; 'none' = no company yet). Company rows: store_id NULL.
type Scope = { kind: 'store'; storeId: string } | { kind: 'company'; companyId: string | null };

// POST /api/hr/schedule/batch — save a whole draft of roster cells in ONE call (§C redesign: the
// grid accumulates changes locally, then saves once). Each cell is either an assignment (shift OR
// day-off) or a clear. Every touched cell returns to 'draft' so the month must be re-published.
// Cells whose date sits in a FINALIZED pay period are skipped (not an error).
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const companyParam = typeof body.company_id === 'string' ? body.company_id : '';
  const scope: Scope | null = companyParam
    ? { kind: 'company', companyId: companyParam === 'none' ? null : companyParam }
    : storeId
      ? { kind: 'store', storeId }
      : null;
  if (!scope) return NextResponse.json({ error: 'store_id or company_id is required' }, { status: 400 });

  const auth = await requireScheduler();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rawCells = Array.isArray(body.cells) ? body.cells : [];
  if (rawCells.length === 0) return NextResponse.json({ error: 'No cells to save' }, { status: 400 });
  if (rawCells.length > MAX_CELLS) {
    return NextResponse.json({ error: `Too many cells (${rawCells.length}); save in smaller batches` }, { status: 400 });
  }

  // Parse + validate each cell's shape. Exactly one of day-off / shift for a non-clear cell.
  const cells: CellInput[] = [];
  for (const c of rawCells) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    const userId = typeof r.user_id === 'string' ? r.user_id : '';
    const workDate = typeof r.work_date === 'string' ? r.work_date : '';
    if (!userId || !DATE_RE.test(workDate)) {
      return NextResponse.json({ error: 'Each cell needs user_id and a valid work_date' }, { status: 400 });
    }
    if (r.clear === true) {
      cells.push({ user_id: userId, work_date: workDate, shift_template_id: null, is_day_off: false, clear: true });
      continue;
    }
    const isDayOff = r.is_day_off === true;
    const shiftTemplateId = typeof r.shift_template_id === 'string' ? r.shift_template_id : null;
    if (isDayOff === !!shiftTemplateId) {
      return NextResponse.json({ error: 'Each cell needs either is_day_off or a shift_template_id' }, { status: 400 });
    }
    cells.push({ user_id: userId, work_date: workDate, shift_template_id: shiftTemplateId, is_day_off: isDayOff });
  }

  const service = createServiceClient();

  const userIds = [...new Set(cells.map((c) => c.user_id))];
  const templateIds = [...new Set(cells.map((c) => c.shift_template_id).filter((x): x is string => !!x))];
  let tplQuery = templateIds.length
    ? service.from('hr_shift_templates').select('id').eq('active', true).in('id', templateIds)
    : null;
  if (tplQuery) {
    if (scope.kind === 'store') tplQuery = tplQuery.eq('store_id', scope.storeId);
    else if (scope.companyId) tplQuery = tplQuery.eq('company_id', scope.companyId);
    else tplQuery = tplQuery.is('store_id', null).is('company_id', null);
  }
  const [userStoresRes, templatesRes, empRes] = await Promise.all([
    // ALL of each employee's stores — the finalized lock must consider every store they work, since
    // hr_schedule is unique on (user_id, work_date): one row per date across all stores.
    service.from('user_stores').select('user_id, store_id').in('user_id', userIds),
    tplQuery ?? Promise.resolve({ data: [], error: null }),
    scope.kind === 'company'
      ? service.from('hr_employees').select('profile_id, company_id').in('profile_id', userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (userStoresRes.error || templatesRes.error || empRes.error) {
    return NextResponse.json({ error: 'Failed to validate staff/shifts' }, { status: 500 });
  }

  const userStores = new Map<string, Set<string>>();
  for (const r of userStoresRes.data ?? []) {
    const uid = r.user_id as string;
    let set = userStores.get(uid);
    if (!set) { set = new Set(); userStores.set(uid, set); }
    set.add(r.store_id as string);
  }
  // Every referenced employee must belong to THIS scope; every template must be the scope's + active.
  if (scope.kind === 'store') {
    const badMember = userIds.find((u) => !userStores.get(u)?.has(scope.storeId));
    if (badMember) return NextResponse.json({ error: 'An employee is not assigned to this store' }, { status: 400 });
  } else {
    const companyByProfile = new Map(
      (empRes.data ?? []).map((r) => [r.profile_id as string, (r.company_id as string | null) ?? null]),
    );
    const badMember = userIds.find((u) => !companyByProfile.has(u) || companyByProfile.get(u) !== scope.companyId);
    if (badMember) return NextResponse.json({ error: 'An employee is not in this company scope' }, { status: 400 });
  }
  const templateSet = new Set((templatesRes.data ?? []).map((t) => t.id as string));
  const badTemplate = templateIds.find((t) => !templateSet.has(t));
  if (badTemplate) return NextResponse.json({ error: 'A shift template is invalid for this scope' }, { status: 400 });

  // §Phase 0B: skip cells whose date is in a finalized pay period — company-wide OR scoped to ANY
  // store the employee works (matching the unique-key semantics + the period-lock convention).
  const dates = cells.map((c) => c.work_date);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));
  const allStoreIds = [...new Set([...userStores.values()].flatMap((s) => [...s]))];
  let finQuery = service
    .from('hr_payruns')
    .select('store_id, cycle_start, cycle_end')
    .eq('status', 'finalized')
    .lte('cycle_start', maxDate)
    .gte('cycle_end', minDate);
  finQuery = allStoreIds.length
    ? finQuery.or(`store_id.is.null,store_id.in.(${allStoreIds.join(',')})`)
    : finQuery.is('store_id', null);
  const { data: finalizedRuns, error: finErr } = await finQuery;
  if (finErr) return NextResponse.json({ error: 'Failed to verify pay periods' }, { status: 500 });

  const isFinalized = (userId: string, d: string) =>
    (finalizedRuns ?? []).some((r) => {
      if (!((r.cycle_start as string) <= d && d <= (r.cycle_end as string))) return false;
      const rs = r.store_id as string | null;
      return rs == null || (userStores.get(userId)?.has(rs) ?? false);
    });

  const savable = cells.filter((c) => !isFinalized(c.user_id, c.work_date));
  const skipped = cells.length - savable.length;
  const toUpsert = savable.filter((c) => !c.clear);
  const toClear = savable.filter((c) => c.clear);

  // Bulk upsert assignments (one row per user/date; any edit returns the cell to draft).
  if (toUpsert.length) {
    const rows = toUpsert.map((c) => ({
      store_id: scope.kind === 'store' ? scope.storeId : null,
      company_id: scope.kind === 'company' ? scope.companyId : null,
      user_id: c.user_id,
      work_date: c.work_date,
      shift_template_id: c.is_day_off ? null : c.shift_template_id,
      is_day_off: c.is_day_off,
      status: 'draft',
      created_by: auth.userId,
    }));
    const { error } = await service.from('hr_schedule').upsert(rows, { onConflict: 'user_id,work_date' });
    if (error) return NextResponse.json({ error: 'Failed to save assignments' }, { status: 500 });
  }

  // Clears: store mode deletes the store's (user, date) rows; company mode deletes the person's
  // row for that date regardless of where it lives — the company view shows (and manages) the
  // full picture, and hr_schedule is unique on (user_id, work_date) anyway. Error-checked so a
  // failed removal is never reported as saved (the client keeps the draft and can retry).
  let clearFailed = 0;
  for (const c of toClear) {
    let del = service.from('hr_schedule').delete().eq('user_id', c.user_id).eq('work_date', c.work_date);
    if (scope.kind === 'store') del = del.eq('store_id', scope.storeId);
    const { error } = await del;
    if (error) clearFailed++;
  }
  if (clearFailed > 0) {
    return NextResponse.json({ error: `Failed to clear ${clearFailed} assignment(s) — please retry` }, { status: 500 });
  }

  return NextResponse.json({ data: { saved: savable.length, skipped } });
}
