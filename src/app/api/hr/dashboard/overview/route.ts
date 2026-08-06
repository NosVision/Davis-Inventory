import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope } from '@/lib/hr/route-auth';
import { openBusinessDateBangkok } from '@/lib/utils/date';
import { computeDaySummary, applyOverride, type Punch, type TimesheetOverride } from '@/lib/hr/time-engine';
import { businessDateBangkok } from '@/lib/utils/date';

// Last business day that has CLOSED. A rostered day after this is still ahead of us, so it must
// never count as an absence (see time-engine's closedThrough).
const CLOSED_THROUGH = () => businessDateBangkok();

// GET /api/hr/dashboard/overview?business_date=&store_id= — the HR dashboard's aggregate feed
// (redesign, §P5.3): today's attendance buckets + per-venue breakdown, and current-month
// summaries (daily trend, leave by type, hires/offboards/warnings, pending queues, payroll +
// evaluation snapshots). Counts only — names stay on /api/hr/dashboard/daily. Scope mirrors
// /daily: company-HR sees everything; a scoped manager sees only their stores (?store_id must
// be inside the scope). Read-only.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_WORK_HOURS = 9;

interface StoreRow { id: string; store_name: string | null; store_code: string | null }
interface ByStore {
  store_id: string;
  store_name: string;
  headcount: number;
  checked_in: number;
  on_leave: number;
  not_in: number;
}

function monthEndOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
/** Inclusive day-count of the overlap between [aFrom,aTo] and [bFrom,bTo] (calendar days). */
function overlapDays(aFrom: string, aTo: string, bFrom: string, bTo: string): number {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = aTo < bTo ? aTo : bTo;
  if (from > to) return 0;
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

export async function GET(request: NextRequest) {
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const sp = request.nextUrl.searchParams;
  const dateParam = sp.get('business_date');
  if (dateParam && !DATE_RE.test(dateParam)) {
    return NextResponse.json({ error: 'Invalid business_date' }, { status: 400 });
  }
  const businessDate = dateParam || openBusinessDateBangkok();
  const month = businessDate.slice(0, 7);
  const monthStart = `${month}-01`;
  const monthEnd = monthEndOf(month);
  // A past month shows its FULL span; the current (or a future-dated) month runs only through the
  // selected day — never past real "today", which has no data yet. (Comparing against businessDate
  // alone would be a tautology since `month` is derived from it, silently truncating past months.)
  const currentMonth = openBusinessDateBangkok().slice(0, 7);
  const trendEnd = month < currentMonth ? monthEnd : businessDate;

  const storeFilter = sp.get('store_id');
  const scopedStoreIds = scope.storeIds; // null = company-HR (all stores)
  let workingStoreIds: string[] | null = scopedStoreIds;
  if (storeFilter) {
    if (scopedStoreIds && !scopedStoreIds.includes(storeFilter)) {
      return NextResponse.json({ error: 'store out of scope' }, { status: 403 });
    }
    workingStoreIds = [storeFilter];
  }
  // profile_changes/evaluation/payroll company rows are company-wide functions — only surfaced
  // for company-HR looking at the unfiltered view (a scoped manager gets store-kept parts only).
  const companyWide = scopedStoreIds === null;

  const service = createServiceClient();

  // ---- store rows for the per-venue breakdown --------------------------------------------
  let storesQuery = service.from('stores').select('id, store_name, store_code');
  if (workingStoreIds) storesQuery = storesQuery.in('id', workingStoreIds);
  else storesQuery = storesQuery.eq('active', true);
  const { data: storeRows, error: storesErr } = await storesQuery;
  if (storesErr) return NextResponse.json({ error: 'Failed to load stores' }, { status: 500 });
  const stores = (storeRows ?? []) as StoreRow[];
  const storeIdsForBreakdown = stores.map((s) => s.id);

  // Fail closed: a scoped caller whose stores resolve to nothing must NOT fall through to the
  // unfiltered membership query below (which would pull the whole company's user_stores rows).
  if (workingStoreIds && storeIdsForBreakdown.length === 0) {
    return NextResponse.json({ data: emptyResult(businessDate, month) });
  }

  // ---- membership map (store → user set) + the in-scope user set --------------------------
  let membersQuery = service.from('user_stores').select('user_id, store_id');
  if (storeIdsForBreakdown.length > 0) membersQuery = membersQuery.in('store_id', storeIdsForBreakdown);
  const { data: memberRows, error: membersErr } = await membersQuery;
  if (membersErr) return NextResponse.json({ error: 'Scope lookup failed' }, { status: 500 });
  const membersByStore = new Map<string, Set<string>>();
  const memberUserIds = new Set<string>();
  for (const r of memberRows ?? []) {
    const set = membersByStore.get(r.store_id as string) ?? new Set<string>();
    set.add(r.user_id as string);
    membersByStore.set(r.store_id as string, set);
    memberUserIds.add(r.user_id as string);
  }

  // Scoped view limits every count to the scope's members; company-wide includes store-less staff.
  const scopedUserFilter: string[] | null = workingStoreIds ? [...memberUserIds] : null;
  if (scopedUserFilter && scopedUserFilter.length === 0) {
    return NextResponse.json({ data: emptyResult(businessDate, month) });
  }

  // ---- active employees (today's population) ----------------------------------------------
  let empQuery = service
    .from('hr_employees')
    .select('profile_id, work_hours_per_day, profile:profiles!hr_employees_profile_id_fkey(active)')
    .eq('status', 'active');
  if (scopedUserFilter) empQuery = empQuery.in('profile_id', scopedUserFilter);
  const { data: empRows, error: empErr } = await empQuery;
  if (empErr) return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 });
  const activeEmp = (empRows ?? []).filter(
    (e) => (e.profile as { active?: boolean } | null)?.active !== false
  );
  const activeIds = new Set(activeEmp.map((e) => e.profile_id as string));
  const workHoursById = new Map(activeEmp.map((e) => [e.profile_id as string, (e.work_hours_per_day as number | null) ?? DEFAULT_WORK_HOURS]));

  // ---- bulk month data (attendance 'in' punches, schedule, overrides, leaves) -------------
  let attQuery = service
    .from('hr_attendance')
    .select('user_id, ts, business_date')
    .eq('type', 'in')
    .gte('business_date', monthStart)
    .lte('business_date', trendEnd);
  if (workingStoreIds) attQuery = attQuery.in('store_id', workingStoreIds);

  let schedQuery = service
    .from('hr_schedule')
    .select('user_id, work_date, is_day_off, shift:hr_shift_templates(start_time, end_time)')
    .gte('work_date', monthStart)
    .lte('work_date', trendEnd);
  if (workingStoreIds) schedQuery = schedQuery.in('store_id', workingStoreIds);

  let ovrQuery = service
    .from('hr_timesheet_overrides')
    .select('user_id, business_date, worked_min, late_min, ot_min, absent, reason')
    .gte('business_date', monthStart)
    .lte('business_date', trendEnd);
  if (scopedUserFilter) ovrQuery = ovrQuery.in('user_id', scopedUserFilter);

  let leaveQuery = service
    .from('hr_leaves')
    .select('user_id, from_date, to_date, leave_type_id')
    .eq('status', 'approved')
    .lte('from_date', monthEnd)
    .gte('to_date', monthStart);
  if (scopedUserFilter) leaveQuery = leaveQuery.in('user_id', scopedUserFilter);

  const [attRes, schedRes, ovrRes, leaveRes] = await Promise.all([attQuery, schedQuery, ovrQuery, leaveQuery]);
  if (attRes.error || schedRes.error || ovrRes.error || leaveRes.error) {
    return NextResponse.json({ error: 'Failed to load month data' }, { status: 500 });
  }

  const punchesByCell = new Map<string, Punch[]>();
  const checkedInByDate = new Map<string, Set<string>>();
  for (const a of attRes.data ?? []) {
    const uid = a.user_id as string;
    if (!activeIds.has(uid)) continue;
    const date = a.business_date as string;
    const key = `${uid}|${date}`;
    const list = punchesByCell.get(key) ?? [];
    list.push({ type: 'in', ts: a.ts as string });
    punchesByCell.set(key, list);
    const set = checkedInByDate.get(date) ?? new Set<string>();
    set.add(uid);
    checkedInByDate.set(date, set);
  }

  interface SchedCell { user_id: string; work_date: string; is_day_off: boolean; shift: { start_time: string; end_time: string } | null }
  const schedByCell = new Map<string, SchedCell>();
  for (const s of (schedRes.data ?? []) as unknown as SchedCell[]) {
    if (activeIds.has(s.user_id)) schedByCell.set(`${s.user_id}|${s.work_date}`, s);
  }
  const overrideByCell = new Map<string, TimesheetOverride>();
  for (const o of ovrRes.data ?? []) {
    overrideByCell.set(`${o.user_id}|${o.business_date}`, {
      worked_min: o.worked_min, late_min: o.late_min, ot_min: o.ot_min, absent: o.absent, reason: o.reason,
    });
  }

  // late per date — the time-engine's late_min (override-aware), only where a shift is scheduled.
  const lateByDate = new Map<string, Set<string>>();
  for (const [key, cell] of schedByCell) {
    if (cell.is_day_off || !cell.shift) continue;
    const [uid, date] = key.split('|');
    const derived = computeDaySummary({
      businessDate: date,
      shift: cell.shift,
      isDayOff: false,
      hasSchedule: true,
      punches: punchesByCell.get(key) ?? [],
      workHoursPerDay: workHoursById.get(uid) ?? DEFAULT_WORK_HOURS,
      otEligible: false,
      closedThrough: CLOSED_THROUGH(),
    });
    const merged = applyOverride(derived, overrideByCell.get(key));
    if ((merged.late_min ?? 0) > 0) {
      const set = lateByDate.get(date) ?? new Set<string>();
      set.add(uid);
      lateByDate.set(date, set);
    }
  }

  // ---- today buckets (mirror /daily semantics) ---------------------------------------------
  const checkedInToday = checkedInByDate.get(businessDate) ?? new Set<string>();
  const onLeaveToday = new Set<string>();
  for (const lv of leaveRes.data ?? []) {
    const uid = lv.user_id as string;
    if (!activeIds.has(uid)) continue;
    if ((lv.from_date as string) <= businessDate && (lv.to_date as string) >= businessDate) onLeaveToday.add(uid);
  }
  const notInToday = [...activeIds].filter((id) => !checkedInToday.has(id) && !onLeaveToday.has(id));

  const byStore: ByStore[] = stores
    .map((s) => {
      const members = [...(membersByStore.get(s.id) ?? new Set<string>())].filter((id) => activeIds.has(id));
      const inCount = members.filter((id) => checkedInToday.has(id)).length;
      const leaveCount = members.filter((id) => !checkedInToday.has(id) && onLeaveToday.has(id)).length;
      return {
        store_id: s.id,
        store_name: s.store_name || s.store_code || '—',
        headcount: members.length,
        checked_in: inCount,
        on_leave: leaveCount,
        not_in: members.length - inCount - leaveCount,
      };
    })
    .filter((r) => r.headcount > 0)
    .sort((a, b) => b.headcount - a.headcount);

  // ---- month trend -------------------------------------------------------------------------
  const days: { date: string; checked_in: number; late: number }[] = [];
  for (let d = monthStart; d <= trendEnd; d = addDays(d, 1)) {
    days.push({ date: d, checked_in: checkedInByDate.get(d)?.size ?? 0, late: lateByDate.get(d)?.size ?? 0 });
  }

  // ---- leave by type (approved days overlapping the month) ---------------------------------
  const daysByType = new Map<string, number>();
  for (const lv of leaveRes.data ?? []) {
    if (!activeIds.has(lv.user_id as string)) continue;
    const n = overlapDays(lv.from_date as string, lv.to_date as string, monthStart, monthEnd);
    if (n > 0 && lv.leave_type_id) {
      daysByType.set(lv.leave_type_id as string, (daysByType.get(lv.leave_type_id as string) ?? 0) + n);
    }
  }
  let leaveByType: { code: string; name_th: string; name_en: string; days: number }[] = [];
  if (daysByType.size > 0) {
    const { data: typeRows } = await service
      .from('hr_leave_types')
      .select('id, code, name_th, name_en')
      .in('id', [...daysByType.keys()]);
    leaveByType = (typeRows ?? [])
      .map((t) => ({
        code: t.code as string,
        name_th: (t.name_th as string) || (t.code as string),
        name_en: (t.name_en as string) || (t.code as string),
        days: daysByType.get(t.id as string) ?? 0,
      }))
      .sort((a, b) => b.days - a.days);
  }

  // ---- month counters: hires / offboards / warnings ----------------------------------------
  const bkkMonthStartTs = `${monthStart}T00:00:00+07:00`;
  const bkkMonthEndTs = `${monthEnd}T23:59:59.999+07:00`;

  let hiresQuery = service
    .from('hr_employees')
    .select('id', { count: 'exact', head: true })
    .gte('start_date', monthStart)
    .lte('start_date', monthEnd);
  if (scopedUserFilter) hiresQuery = hiresQuery.in('profile_id', scopedUserFilter);

  let offbQuery = service
    .from('hr_employees')
    .select('id', { count: 'exact', head: true })
    .in('status', ['resigned', 'terminated'])
    .gte('end_date', monthStart)
    .lte('end_date', monthEnd);
  if (scopedUserFilter) offbQuery = offbQuery.in('profile_id', scopedUserFilter);

  let warnQuery = service
    .from('hr_warnings')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'void')
    .gte('issued_at', bkkMonthStartTs)
    .lte('issued_at', bkkMonthEndTs);
  if (scopedUserFilter) warnQuery = warnQuery.in('user_id', scopedUserFilter);

  // ---- pending queues ------------------------------------------------------------------------
  const pendingCount = (table: string, storeKeyed: boolean) => {
    let q = service.from(table).select('id', { count: 'exact', head: true }).eq('status', 'pending');
    if (workingStoreIds) {
      if (storeKeyed) q = q.in('store_id', workingStoreIds);
      else q = q.in('user_id', scopedUserFilter ?? []);
    }
    return q;
  };

  const [hiresRes, offbRes, warnRes, pLeaves, pOt, pAtt, pClaims, pProfile] = await Promise.all([
    hiresQuery,
    offbQuery,
    warnQuery,
    pendingCount('hr_leaves', true),
    pendingCount('hr_ot_requests', true),
    pendingCount('hr_attendance_requests', true),
    pendingCount('hr_claims', true),
    companyWide && !storeFilter
      ? service.from('hr_profile_change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      : Promise.resolve({ count: null, error: null }),
  ]);

  // ---- payroll snapshot (current period, scope-aware like T1) -------------------------------
  const [periodYear, periodMonth] = month.split('-').map(Number);
  let payrunQuery = service
    .from('hr_payruns')
    .select('id, status, store_id')
    .eq('period_year', periodYear)
    .eq('period_month', periodMonth);
  if (workingStoreIds) payrunQuery = payrunQuery.in('store_id', workingStoreIds);
  const { data: payruns } = await payrunQuery;
  let payroll: { runs: number; finalized: number; slips: number; net_total_satang: number | null } | null = null;
  if (payruns && payruns.length > 0) {
    const { data: slipRows } = await service
      .from('hr_payslips')
      .select('net_satang, payrun_id')
      .in('payrun_id', payruns.map((r) => r.id as string));
    const slips = slipRows ?? [];
    const netTotal = slips.reduce((sum, s) => sum + ((s.net_satang as number) ?? 0), 0);
    // k-anonymity floor: a store's net-pay SUM over 1–2 slips would reveal an individual's salary.
    // Company-HR can already open the payslips themselves, so the floor only applies to scoped mgrs.
    const MIN_PAYROLL_COHORT = 3;
    payroll = {
      runs: payruns.length,
      finalized: payruns.filter((r) => r.status === 'finalized').length,
      slips: slips.length,
      net_total_satang: !companyWide && slips.length < MIN_PAYROLL_COHORT ? null : netTotal,
    };
  }

  // ---- evaluation snapshot (company-wide function) ------------------------------------------
  let evaluation: { periods: number; assignments: number; submitted: number } | null = null;
  if (companyWide) {
    const { data: periods } = await service
      .from('hr_eval_periods')
      .select('id, status')
      .eq('period_month', month)
      .neq('status', 'void');
    if (periods && periods.length > 0) {
      const { data: assigns } = await service
        .from('hr_eval_assignments')
        .select('id, status')
        .in('period_id', periods.map((p) => p.id as string));
      const all = assigns ?? [];
      evaluation = {
        periods: periods.length,
        assignments: all.length,
        submitted: all.filter((a) => a.status === 'submitted').length,
      };
    }
  }

  return NextResponse.json({
    data: {
      business_date: businessDate,
      month,
      today: {
        headcount: activeIds.size,
        checked_in: checkedInToday.size,
        on_leave: [...onLeaveToday].filter((id) => !checkedInToday.has(id)).length,
        not_in: notInToday.length,
        late: lateByDate.get(businessDate)?.size ?? 0,
        by_store: byStore,
      },
      month_summary: {
        days,
        leave_by_type: leaveByType,
        new_hires: hiresRes.count ?? 0,
        offboarded: offbRes.count ?? 0,
        warnings: warnRes.count ?? 0,
        pending: {
          leaves: pLeaves.count ?? 0,
          ot: pOt.count ?? 0,
          attendance: pAtt.count ?? 0,
          claims: pClaims.count ?? 0,
          profile_changes: pProfile.count, // null when out of view (scoped/store-filtered)
        },
        payroll,
        evaluation,
      },
    },
  });
}

function emptyResult(businessDate: string, month: string) {
  return {
    business_date: businessDate,
    month,
    today: { headcount: 0, checked_in: 0, on_leave: 0, not_in: 0, late: 0, by_store: [] },
    month_summary: {
      days: [],
      leave_by_type: [],
      new_hires: 0,
      offboarded: 0,
      warnings: 0,
      pending: { leaves: 0, ot: 0, attendance: 0, claims: 0, profile_changes: null },
      payroll: null,
      evaluation: null,
    },
  };
}
