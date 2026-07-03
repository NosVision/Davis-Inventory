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
}
interface EmployeeRow {
  profile_id: string;
  work_hours_per_day: number | null;
  ot_eligible: boolean | null;
  status: string | null;
}
interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
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

  const [profilesRes, employeesRes, scheduleRes, attendanceRes, overridesRes] = await Promise.all([
    service.from('profiles').select('id, username, display_name').in('id', userIds),
    service
      .from('hr_employees')
      .select('profile_id, work_hours_per_day, ot_eligible, status')
      .in('profile_id', userIds),
    service
      .from('hr_schedule')
      .select('user_id, work_date, is_day_off, shift:hr_shift_templates(start_time, end_time)')
      .eq('store_id', storeId)
      .gte('work_date', from)
      .lte('work_date', to),
    service
      .from('hr_attendance')
      .select('user_id, type, ts, business_date')
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
  ]);
  if (
    profilesRes.error ||
    employeesRes.error ||
    scheduleRes.error ||
    attendanceRes.error ||
    overridesRes.error
  ) {
    return NextResponse.json({ error: 'Failed to load timesheet data' }, { status: 500 });
  }

  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const employees = (employeesRes.data ?? []) as EmployeeRow[];
  const schedule = (scheduleRes.data ?? []) as unknown as ScheduleCell[];
  const attendance = (attendanceRes.data ?? []) as AttendanceRow[];
  const overrides = (overridesRes.data ?? []) as OverrideRow[];
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
      const days: DaySummary[] = dates.map((date) => {
        const cell = schedByCell.get(`${uid}|${date}`);
        const derived = computeDaySummary({
          businessDate: date,
          shift: cell?.shift ?? null,
          isDayOff: cell?.is_day_off ?? false,
          hasSchedule: !!cell,
          punches: punchesByCell.get(`${uid}|${date}`) ?? [],
          workHoursPerDay: workHours,
          otEligible,
        });
        return applyOverride(derived, overrideByCell.get(`${uid}|${date}`));
      });
      return {
        user_id: uid,
        name: p?.display_name || p?.username || '—',
        work_hours_per_day: workHours,
        ot_eligible: otEligible,
        days,
        totals: sumDays(days),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ employees: staff, from, to });
}
