import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { openBusinessDateBangkok } from '@/lib/utils/date';
import {
  computeDaySummary,
  applyOverride,
  sumDays,
  type Punch,
  type DaySummary,
  type TimesheetOverride,
} from '@/lib/hr/time-engine';
import { getHrPolicies } from '@/lib/hr/policy';
import {
  loadVenueAttachment,
  loadMemberVenues,
  belongsToVenue,
  loadAssignedWorkStores,
  loadAssignedToVenue,
} from '@/lib/hr/work-venues';
import { businessDateBangkok } from '@/lib/utils/date';

// Last business day that has CLOSED. A rostered day after this is still ahead of us, so it must
// never count as an absence (see time-engine's closedThrough).
const CLOSED_THROUGH = () => businessDateBangkok();

interface OverrideRow {
  user_id: string;
  business_date: string;
  worked_min: number | null;
  late_min: number | null;
  ot_min: number | null;
  absent: boolean | null;
  reason: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** store_id sentinel for "employees not attached to any venue" (see GET). */
export const NO_STORE = 'none';
const MAX_RANGE_DAYS = 62;
const DEFAULT_WORK_HOURS = 9;

interface ScheduleCell {
  user_id: string;
  work_date: string;
  is_day_off: boolean;
  shift: { start_time: string; end_time: string } | null;
}
interface AttendanceRow {
  user_id: string;
  type: Punch['type'];
  ts: string;
  business_date: string;
  review_status: string | null;
}
/** A PostgREST to-one embed arrives as an object, but the generated types widen it to an array. */
type NamedRef = { name: string | null } | { name: string | null }[] | null;
function refName(r: NamedRef | undefined): string | null {
  if (!r) return null;
  return (Array.isArray(r) ? r[0]?.name : r.name) ?? null;
}

interface EmployeeRow {
  profile_id: string;
  company_id: string | null;
  full_name: string | null;
  work_hours_per_day: number | null;
  ot_eligible: boolean | null;
  /** Day-rated staff are paid worked_days × rate, so a day edit that credits no hours costs them. */
  pay_type: string | null;
  status: string | null;
  end_date: string | null;
  // Why a venue's timesheet and its payrun list different people: the timesheet is keyed on store
  // membership, a payrun on company + payroll group. Sent along so the row can say so itself.
  company?: NamedRef;
  payroll_group?: NamedRef;
}
interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
}
interface LeaveRow {
  id: string;
  user_id: string;
  from_date: string;
  to_date: string;
  leave_type: { code: string; name_th: string | null; name_en: string | null } | null;
}
/** The leave that covers a timesheet day, surfaced so the UI shows "ลา (type)" not "ขาด". */
export interface DayLeave {
  id: string;
  code: string;
  name_th: string;
  name_en: string;
}

function isCalendarDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i <= MAX_RANGE_DAYS && cur <= to; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

// GET /api/hr/timesheet?store_id&from&to&user_id? — the time engine's reconciliation of
// attendance punches vs the scheduled shift for a store's staff over a date range (§A/§F/§I).
// Read-only, derived on demand (never trusts stored metrics). Manager/HR only.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeParam = sp.get('store_id') ?? '';
  // `store_id=none` = the staff who belong to a COMPANY but no venue (office: HR, accounting,
  // graphic). They have no user_stores row, so a store-keyed roster could never list them and HR
  // had no way to back-fill their hours at all. Company-wide HR only — there is no store manager
  // who owns them. A blank store_id still 400s, as before.
  const noStore = storeParam === NO_STORE;
  // Company scope (owner ask 2026-08-17), mirroring the roster's existing store ↔ company switch.
  // Payroll is generated per company, so this is the axis on which the timesheet and the payrun list
  // the same people — which is what HR was trying to reconcile by hand. 'none' = no company yet.
  const companyParam = sp.get('company_id') ?? '';
  const companyScope = companyParam ? { companyId: companyParam === 'none' ? null : companyParam } : null;
  // A member listed at a venue with no roster row and no punch there is being shown on the strength
  // of a user_stores row that may only mean "can see this venue". Off by default; HR can ask for
  // them back per view.
  const includeInactive = sp.get('include_inactive') === 'true';
  const storeId = noStore || companyScope ? '' : storeParam;
  // A company-wide list is company-wide HR's; a venue's list stays reachable by its own manager.
  const auth = await requireHrManagerForStore(noStore || companyScope ? null : storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const today = openBusinessDateBangkok();
  const from = sp.get('from') || today;
  const to = sp.get('to') || from;
  const userFilter = sp.get('user_id');
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
  }
  const dates = dateRange(from, to);
  if (dates.length === 0 || dates[dates.length - 1] < to) {
    return NextResponse.json({ error: 'Date range too large' }, { status: 400 });
  }

  const service = createServiceClient();

  // Staff of the store (optionally a single employee) — or, for the no-store bucket, every active
  // employee with no user_stores row anywhere (plus leavers whose last working day falls in or
  // after this window, so a just-offboarded person's final period stays viewable).
  // Who counts as staff for this window, in BOTH buckets: someone currently employed, or a leaver
  // whose last working day falls in or after it (so a just-offboarded person's final period stays
  // viewable). Matches the payroll rule — including probation, which the no-store bucket used to
  // miss — so the timesheet and the payrun show the same people.
  //
  // The store bucket used to take every user_stores row with no filter at all, which is why the
  // 101 logins deactivated on 2026-08-11 still appeared here after they had vanished from payroll:
  // deactivating a profile does not remove its store membership, and most of them never had an
  // employee record to begin with (owner report).
  let eligQuery = service
    .from('hr_employees')
    .select('profile_id, company_id')
    .or(`status.in.(active,probation),end_date.gte.${from}`);
  // Company scope narrows the eligible set itself — every employee of that company, venue or not.
  if (companyScope) {
    eligQuery = companyScope.companyId
      ? eligQuery.eq('company_id', companyScope.companyId)
      : eligQuery.is('company_id', null);
  }
  const { data: eligibleEmps, error: eligErr } = await eligQuery;
  if (eligErr) return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
  const eligible = new Set(
    (eligibleEmps ?? []).map((r) => r.profile_id as string | null).filter((id): id is string => !!id)
  );

  // Members of this venue who are only listed here because a user_stores row says so — no roster
  // row and no punch at this venue in the window. Reported separately so nobody vanishes silently.
  let inactiveHere: string[] = [];
  let userIds: string[];
  if (companyScope) {
    userIds = [...eligible];
  } else if (noStore) {
    const { data: links, error: linkErr } = await service.from('user_stores').select('user_id');
    if (linkErr) return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
    const attached = new Set((links ?? []).map((r) => r.user_id as string));
    userIds = [...eligible].filter((id) => !attached.has(id));
  } else {
    const [membersRes, assignedHere] = await Promise.all([
      service.from('user_stores').select('user_id').eq('store_id', storeId),
      // Anyone HR has ASSIGNED here (hr_employees.work_store_id) belongs on this sheet even if no
      // user_stores row says so — that table is an access grant, not a staff list.
      loadAssignedToVenue(service, storeId).catch(() => [] as string[]),
    ]);
    if (membersRes.error) return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
    userIds = [
      ...new Set([
        ...(membersRes.data ?? []).map((r: { user_id: string }) => r.user_id),
        ...assignedHere,
      ]),
    ].filter((id) => eligible.has(id));

    // Split the venue's members on evidence of actually working here. Single-venue members always
    // stay — a new hire with nothing on record yet is exactly who HR opens this page to back-fill.
    try {
      const [worked, memberOf, assigned] = await Promise.all([
        // Attachment, not this window's activity: a fresh pay cycle starts empty, and that must not
        // detach a multi-venue employee from the venue they work every cycle.
        loadVenueAttachment(service, from, to),
        loadMemberVenues(service, userIds),
        loadAssignedWorkStores(service, userIds),
      ]);
      const listed: string[] = [];
      for (const uid of userIds) {
        const keep = belongsToVenue({
          storeId,
          memberStoreIds: memberOf.get(uid) ?? [storeId],
          workedStoreIds: worked.get(uid),
          assignedStoreId: assigned.get(uid) ?? null,
        });
        if (keep) listed.push(uid);
        else inactiveHere.push(uid);
      }
      if (!includeInactive) userIds = listed;
    } catch {
      // Evidence unavailable → fall back to listing every member, the pre-2026-08-17 behaviour.
      // Showing too many is recoverable; hiding someone's hours silently is not.
      inactiveHere = [];
    }
  }
  if (userFilter) {
    // Checked against members INCLUDING the ones filtered out of the grid: a deep link to one
    // person (the payslip's "fix this person's OT" link) must still resolve for a venue member
    // whose evidence happens to sit at another venue.
    if (!userIds.includes(userFilter) && !inactiveHere.includes(userFilter)) {
      return NextResponse.json({ error: 'Employee is not in this store' }, { status: 400 });
    }
    userIds = [userFilter];
    inactiveHere = [];
  }
  // Drop system accounts. The store branch above takes every user_stores member, and a print
  // server IS a store member (that is how it authenticates) — so printers were appearing as rows
  // in the attendance file, with no punches and nothing to explain (owner ask 2026-08-11).
  if (userIds.length > 0) {
    const { data: systemProfiles } = await service
      .from('profiles')
      .select('id')
      .eq('is_system', true)
      .in('id', userIds);
    const systemIds = new Set((systemProfiles ?? []).map((r) => r.id as string));
    if (systemIds.size) userIds = userIds.filter((id) => !systemIds.has(id));
  }

  // Names for the people held out of the grid, plus the company list the scope picker needs. Both
  // are small, both are needed even when the grid itself is empty.
  const loadAside = async () => {
    const [companiesRes, inactiveRes] = await Promise.all([
      service.from('hr_companies').select('id, name').order('name'),
      inactiveHere.length > 0
        ? service
            .from('hr_employees')
            .select('profile_id, full_name, profile:profiles!hr_employees_profile_id_fkey(display_name, username)')
            .in('profile_id', inactiveHere)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const rows = (inactiveRes.data ?? []) as unknown as {
      profile_id: string;
      full_name: string | null;
      profile: { display_name: string | null; username: string | null } | null;
    }[];
    return {
      companies: companiesRes.data ?? [],
      inactive_here: rows
        .map((r) => ({
          user_id: r.profile_id,
          name: r.full_name?.trim() || r.profile?.display_name || r.profile?.username || '—',
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'th')),
    };
  };

  if (userIds.length === 0) {
    return NextResponse.json({ employees: [], from, to, ...(await loadAside()) });
  }

  const [profilesRes, employeesRes, scheduleRes, attendanceRes, overridesRes, leavesRes] = await Promise.all([
    service.from('profiles').select('id, username, display_name').in('id', userIds),
    service
      .from('hr_employees')
      .select(
        'profile_id, company_id, full_name, work_hours_per_day, ot_eligible, pay_type, status, end_date, ' +
          'company:hr_companies(name), payroll_group:hr_payroll_groups(name)'
      )
      .in('profile_id', userIds),
    // No-store and company scopes key on user_id alone. The no-store bucket belongs to no venue, so
    // there is no other store's data to leak in; the company scope deliberately wants every venue's
    // hours for its people, since the company is what payroll pays. Only a VENUE view scopes by
    // store — there a multi-venue employee's hours elsewhere must not inflate this venue's sheet.
    (noStore || companyScope
      ? service
          .from('hr_schedule')
          .select('user_id, work_date, is_day_off, shift:hr_shift_templates(start_time, end_time)')
          .in('user_id', userIds)
      : service
          .from('hr_schedule')
          .select('user_id, work_date, is_day_off, shift:hr_shift_templates(start_time, end_time)')
          .eq('store_id', storeId)
    )
      .gte('work_date', from)
      .lte('work_date', to),
    (noStore || companyScope
      ? service
          .from('hr_attendance')
          .select('user_id, type, ts, business_date, review_status')
          .in('user_id', userIds)
      : service
          .from('hr_attendance')
          .select('user_id, type, ts, business_date, review_status')
          .eq('store_id', storeId) // scope to THIS store — a multi-store employee's punches
          .in('user_id', userIds) //  elsewhere must not leak into / inflate this timesheet
    )
      .gte('business_date', from)
      .lte('business_date', to),
    service
      .from('hr_timesheet_overrides')
      .select('user_id, business_date, worked_min, late_min, ot_min, absent, reason')
      .in('user_id', userIds)
      .gte('business_date', from)
      .lte('business_date', to),
    // Approved leaves overlapping the window → overlay each covered day as "ลา (type)" so a
    // scheduled-but-not-punched day on approved leave reads as leave, not absent (owner ask).
    service
      .from('hr_leaves')
      .select('id, user_id, from_date, to_date, leave_type:hr_leave_types(code, name_th, name_en)')
      .in('user_id', userIds)
      .eq('status', 'approved')
      .lte('from_date', to)
      .gte('to_date', from),
  ]);
  if (
    profilesRes.error ||
    employeesRes.error ||
    scheduleRes.error ||
    attendanceRes.error ||
    overridesRes.error ||
    leavesRes.error
  ) {
    return NextResponse.json({ error: 'Failed to load timesheet data' }, { status: 500 });
  }

  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const employees = (employeesRes.data ?? []) as unknown as EmployeeRow[];
  const schedule = (scheduleRes.data ?? []) as unknown as ScheduleCell[];
  const attendance = (attendanceRes.data ?? []) as AttendanceRow[];
  const overrides = (overridesRes.data ?? []) as OverrideRow[];
  const leaves = (leavesRes.data ?? []) as unknown as LeaveRow[];

  // Map (user|date) → the covering leave, for each day within the leave's inclusive span.
  const leaveByCell = new Map<string, DayLeave>();
  for (const lv of leaves) {
    const info: DayLeave = {
      id: lv.id,
      code: lv.leave_type?.code ?? 'leave',
      name_th: lv.leave_type?.name_th ?? lv.leave_type?.code ?? 'ลา',
      name_en: lv.leave_type?.name_en ?? lv.leave_type?.code ?? 'Leave',
    };
    for (const d of dates) {
      if (d >= lv.from_date && d <= lv.to_date) leaveByCell.set(`${lv.user_id}|${d}`, info);
    }
  }
  const overrideByCell = new Map<string, TimesheetOverride>(
    overrides.map((o) => [
      `${o.user_id}|${o.business_date}`,
      { worked_min: o.worked_min, late_min: o.late_min, ot_min: o.ot_min, absent: o.absent, reason: o.reason },
    ])
  );

  const profById = new Map(profiles.map((p) => [p.id, p]));
  const empById = new Map(employees.map((e) => [e.profile_id, e]));

  const schedByCell = new Map(schedule.map((s) => [`${s.user_id}|${s.work_date}`, s]));
  const punchesByCell = new Map<string, Punch[]>();
  for (const a of attendance) {
    // A punch HR rejected in geofence review is dismissed — it must not count toward hours/pay.
    if (a.review_status === 'rejected') continue;
    const key = `${a.user_id}|${a.business_date}`;
    const list = punchesByCell.get(key) ?? [];
    list.push({ type: a.type, ts: a.ts });
    punchesByCell.set(key, list);
  }

  // A store member is on the timesheet unless they had already left before this window
  // began: a leaver stays visible while the viewed period overlaps their employment
  // (end_date >= window start), mirroring the payroll leaver-window, then drops off in
  // later periods. Keeps a just-offboarded person's final timesheet viewable (client
  // ask 2026-07-22).
  const staff = userIds
    .filter((uid) => {
      const e = empById.get(uid);
      if (!e) return true;
      if (e.status !== 'resigned' && e.status !== 'terminated') return true;
      return !!e.end_date && e.end_date >= from;
    })
    .map((uid) => {
      const p = profById.get(uid);
      const e = empById.get(uid);
      const workHours = e?.work_hours_per_day ?? DEFAULT_WORK_HOURS;
      const otEligible = e?.ot_eligible ?? false;
      const days: (DaySummary & { leave: DayLeave | null })[] = dates.map((date) => {
        const cell = schedByCell.get(`${uid}|${date}`);
        const derived = computeDaySummary({
          businessDate: date,
          shift: cell?.shift ?? null,
                    // The roster is the only record of whether a day was a working day — public holidays
          // were retired as a system concept (owner decision 2026-08-18). A holiday the venue works
          // is a rostered shift; a holiday it takes off is a rostered day off.
          isDayOff: cell?.is_day_off ?? false,
          hasSchedule: !!cell,
          punches: punchesByCell.get(`${uid}|${date}`) ?? [],
          workHoursPerDay: workHours,
          otEligible,
          closedThrough: CLOSED_THROUGH(),
        });
        const merged = applyOverride(derived, overrideByCell.get(`${uid}|${date}`));
        const leave = leaveByCell.get(`${uid}|${date}`) ?? null;
        // A covered leave day is not an "absence" — it reads as leave and drops out of the
        // absent tally (payroll reconciles leave-vs-absent on its own path).
        return leave ? { ...merged, absent: false, leave } : { ...merged, leave: null };
      });
      const departed = e?.status === 'resigned' || e?.status === 'terminated';
      return {
        user_id: uid,
        // Prefer the employee's real full name (ชื่อ-นามสกุล); fall back to the profile
        // nickname/username only when it's unset (e.g. an unlinked account).
        name: e?.full_name?.trim() || p?.display_name || p?.username || '—',
        // The venue's own word for this person. Sent so the row can offer it on hover without
        // spending width on it — profiles.display_name is not always even a name (several
        // accounting logins are called after a department), so it must never lead.
        nickname: p?.display_name ?? null,
        company_id: e?.company_id ?? null,
        // Payrun scope, for the chips that explain a store-vs-company list difference.
        company_name: e ? refName(e.company) : null,
        payroll_group_name: e ? refName(e.payroll_group) : null,
        work_hours_per_day: workHours,
        ot_eligible: otEligible,
        pay_type: e?.pay_type ?? null,
        // Set only for leavers — lets the timesheet UI flag the row as departed.
        end_date: departed ? (e?.end_date ?? null) : null,
        days,
        totals: sumDays(days),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Active leave types (for the HR day-edit "mark as leave" picker). Returned in the payload so
  // the modal needs no extra fetch — and store-scoped managers (who lack the company-wide
  // can_manage_hr the /leave-types route requires) still get them. Client filters by company.
  const { data: leaveTypesData } = await service
    .from('hr_leave_types')
    .select('id, code, name_th, name_en, company_id')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  const leaveTypes = leaveTypesData ?? [];

  const scoreConfig = (await getHrPolicies(service)).work_index;
  return NextResponse.json({
    employees: staff,
    from,
    to,
    score_config: scoreConfig,
    leave_types: leaveTypes,
    ...(await loadAside()),
  });
}
