import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
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
interface EmployeeRow {
  profile_id: string;
  company_id: string | null;
  full_name: string | null;
  work_hours_per_day: number | null;
  ot_eligible: boolean | null;
  status: string | null;
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
  const storeId = sp.get('store_id') ?? '';
  const auth = await requireStoreManager(storeId);
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

  // Staff of the store (optionally a single employee).
  const { data: members, error: membersErr } = await service
    .from('user_stores')
    .select('user_id')
    .eq('store_id', storeId);
  if (membersErr) return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
  let userIds = (members ?? []).map((r: { user_id: string }) => r.user_id);
  if (userFilter) {
    if (!userIds.includes(userFilter)) {
      return NextResponse.json({ error: 'Employee is not in this store' }, { status: 400 });
    }
    userIds = [userFilter];
  }
  if (userIds.length === 0) return NextResponse.json({ employees: [], from, to });

  const [profilesRes, employeesRes, scheduleRes, attendanceRes, overridesRes, leavesRes] = await Promise.all([
    service.from('profiles').select('id, username, display_name').in('id', userIds),
    service
      .from('hr_employees')
      .select('profile_id, company_id, full_name, work_hours_per_day, ot_eligible, status')
      .in('profile_id', userIds),
    service
      .from('hr_schedule')
      .select('user_id, work_date, is_day_off, shift:hr_shift_templates(start_time, end_time)')
      .eq('store_id', storeId)
      .gte('work_date', from)
      .lte('work_date', to),
    service
      .from('hr_attendance')
      .select('user_id, type, ts, business_date, review_status')
      .eq('store_id', storeId) // scope to THIS store — a multi-store employee's punches
      .in('user_id', userIds) //  elsewhere must not leak into / inflate this timesheet
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
  const employees = (employeesRes.data ?? []) as EmployeeRow[];
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

  // Company public holidays in range → treated as day-off so a holiday never reads as "absent"
  // (matches payroll). Global holidays (company_id NULL) apply to everyone; company holidays only
  // to that company's staff.
  const companyIds = [...new Set(employees.map((e) => e.company_id).filter(Boolean))] as string[];
  const { data: holidayRows } = await service
    .from('hr_holidays')
    .select('holiday_date, company_id')
    .eq('active', true)
    .gte('holiday_date', from)
    .lte('holiday_date', to)
    .or(`company_id.is.null${companyIds.length ? `,company_id.in.(${companyIds.join(',')})` : ''}`);
  const globalHolidays = new Set<string>();
  const holidaysByCompany = new Map<string, Set<string>>();
  for (const h of (holidayRows ?? []) as { holiday_date: string; company_id: string | null }[]) {
    if (h.company_id == null) globalHolidays.add(h.holiday_date);
    else (holidaysByCompany.get(h.company_id) ?? holidaysByCompany.set(h.company_id, new Set()).get(h.company_id)!).add(h.holiday_date);
  }
  const isHoliday = (companyId: string | null, date: string) =>
    globalHolidays.has(date) || (companyId != null && (holidaysByCompany.get(companyId)?.has(date) ?? false));
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

  // A store member is on the timesheet unless their HR record is resigned/terminated.
  const staff = userIds
    .filter((uid) => {
      const e = empById.get(uid);
      return !e || (e.status !== 'resigned' && e.status !== 'terminated');
    })
    .map((uid) => {
      const p = profById.get(uid);
      const e = empById.get(uid);
      const workHours = e?.work_hours_per_day ?? DEFAULT_WORK_HOURS;
      const otEligible = e?.ot_eligible ?? false;
      const empCompany = e?.company_id ?? null;
      const days: (DaySummary & { leave: DayLeave | null })[] = dates.map((date) => {
        const cell = schedByCell.get(`${uid}|${date}`);
        const derived = computeDaySummary({
          businessDate: date,
          shift: cell?.shift ?? null,
          isDayOff: (cell?.is_day_off ?? false) || isHoliday(empCompany, date),
          hasSchedule: !!cell,
          punches: punchesByCell.get(`${uid}|${date}`) ?? [],
          workHoursPerDay: workHours,
          otEligible,
        });
        const merged = applyOverride(derived, overrideByCell.get(`${uid}|${date}`));
        const leave = leaveByCell.get(`${uid}|${date}`) ?? null;
        // A covered leave day is not an "absence" — it reads as leave and drops out of the
        // absent tally (payroll reconciles leave-vs-absent on its own path).
        return leave ? { ...merged, absent: false, leave } : { ...merged, leave: null };
      });
      return {
        user_id: uid,
        // Prefer the employee's real full name (ชื่อ-นามสกุล); fall back to the profile
        // nickname/username only when it's unset (e.g. an unlinked account).
        name: e?.full_name?.trim() || p?.display_name || p?.username || '—',
        company_id: e?.company_id ?? null,
        work_hours_per_day: workHours,
        ot_eligible: otEligible,
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
  return NextResponse.json({ employees: staff, from, to, score_config: scoreConfig, leave_types: leaveTypes });
}
