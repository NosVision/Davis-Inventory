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
import { resolveRoster, rosterMemberName, type RosterMember, type RosterScope } from '@/lib/hr/roster';
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
const NO_STORE = 'none';
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

  // Who is on this sheet is decided by lib/hr/roster.ts — the same rule the roster and the SC pool
  // use, so the three surfaces list the same people (HR kept asking "ระบบดึงชื่อจากอะไร",
  // 2026-09-19). In every scope: a linked employee record, no system accounts, and the employed-
  // window rule (currently employed, or a leaver whose last day falls in or after this window —
  // matching payroll's leaver-window, probation included). Store scope is further split on venue
  // evidence; `store_id=none` is everyone attached to no venue by either user_stores or
  // work_store_id.
  const rosterScope: RosterScope = companyScope
    ? { kind: 'company', companyId: companyScope.companyId }
    : noStore
      ? { kind: 'no_venue' }
      : { kind: 'store', storeId };
  let members: RosterMember[];
  // Members of this venue who are only listed here because a user_stores row says so — no roster
  // row and no punch at this venue in the window. Reported separately so nobody vanishes silently.
  let inactiveMembers: RosterMember[];
  try {
    const roster = await resolveRoster(service, { scope: rosterScope, from, to, includeInactive });
    members = roster.members;
    inactiveMembers = roster.inactiveHere;
  } catch {
    return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
  }
  if (userFilter) {
    // Checked against members INCLUDING the ones filtered out of the grid: a deep link to one
    // person (the payslip's "fix this person's OT" link) must still resolve for a venue member
    // whose evidence happens to sit at another venue.
    const one = [...members, ...inactiveMembers].find((m) => m.profile_id === userFilter);
    if (!one) return NextResponse.json({ error: 'Employee is not in this store' }, { status: 400 });
    members = [one];
    inactiveMembers = [];
  }
  const userIds = members.map((m) => m.profile_id);

  // Names for the people held out of the grid, plus the company list the scope picker needs. Both
  // are small, both are needed even when the grid itself is empty.
  const loadAside = async () => {
    const companiesRes = await service.from('hr_companies').select('id, name').order('name');
    return {
      companies: companiesRes.data ?? [],
      inactive_here: inactiveMembers.map((m) => ({ user_id: m.profile_id, name: rosterMemberName(m) })),
    };
  };

  if (userIds.length === 0) {
    return NextResponse.json({ employees: [], from, to, ...(await loadAside()) });
  }

  const [scheduleRes, attendanceRes, overridesRes, leavesRes] = await Promise.all([
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
  if (scheduleRes.error || attendanceRes.error || overridesRes.error || leavesRes.error) {
    return NextResponse.json({ error: 'Failed to load timesheet data' }, { status: 500 });
  }

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

  // The leaver-window (a just-offboarded person's final period stays viewable, client ask
  // 2026-07-22) was applied by resolveRoster; every member here is on the sheet.
  const staff = members
    .map((m) => {
      const uid = m.profile_id;
      const workHours = m.work_hours_per_day ?? DEFAULT_WORK_HOURS;
      const otEligible = m.ot_eligible ?? false;
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
      const departed = m.status === 'resigned' || m.status === 'terminated';
      return {
        user_id: uid,
        // Prefer the employee's real full name (ชื่อ-นามสกุล); fall back to the profile
        // nickname/username only when it's unset (e.g. an unlinked account).
        name: rosterMemberName(m),
        // The venue's own word for this person. Sent so the row can offer it on hover without
        // spending width on it — profiles.display_name is not always even a name (several
        // accounting logins are called after a department), so it must never lead.
        nickname: m.display_name,
        company_id: m.company_id,
        // Payrun scope, for the chips that explain a store-vs-company list difference.
        company_name: m.company_name,
        payroll_group_name: m.payroll_group_name,
        work_hours_per_day: workHours,
        ot_eligible: otEligible,
        // Day-rated staff are paid worked_days × rate, so a day edit that credits no hours costs them.
        pay_type: m.pay_type,
        // Set only for leavers — lets the timesheet UI flag the row as departed.
        end_date: departed ? m.end_date : null,
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
