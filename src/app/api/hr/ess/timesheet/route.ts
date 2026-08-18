import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
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
import { businessDateBangkok } from '@/lib/utils/date';

// Last business day that has CLOSED. A rostered day after this is still ahead of us, so it must
// never count as an absence (see time-engine's closedThrough).
const CLOSED_THROUGH = () => businessDateBangkok();

interface OverrideRow {
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
  work_date: string;
  is_day_off: boolean;
  shift: { start_time: string; end_time: string } | null;
}
interface AttendanceRow {
  type: Punch['type'];
  ts: string;
  business_date: string;
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

// GET /api/hr/ess/timesheet?from&to — the CALLER's own reconciled timesheet (§A/§F/§I).
// Auth-any: an employee sees only their own days. Derived on demand from their punches
// + schedule; no money (that's payroll P4).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const today = openBusinessDateBangkok();
  const from = sp.get('from') || today;
  const to = sp.get('to') || from;
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
  }
  const dates = dateRange(from, to);
  if (dates.length === 0 || dates[dates.length - 1] < to) {
    return NextResponse.json({ error: 'Date range too large' }, { status: 400 });
  }

  const service = createServiceClient();
  const [empRes, scheduleRes, attendanceRes, overridesRes] = await Promise.all([
    service
      .from('hr_employees')
      .select('work_hours_per_day, ot_eligible, company_id')
      .eq('profile_id', user.id)
      .maybeSingle(),
    service
      .from('hr_schedule')
      .select('work_date, is_day_off, shift:hr_shift_templates(start_time, end_time)')
      .eq('user_id', user.id)
      .gte('work_date', from)
      .lte('work_date', to),
    service
      .from('hr_attendance')
      .select('type, ts, business_date')
      .eq('user_id', user.id)
      .gte('business_date', from)
      .lte('business_date', to)
      // Exclude HR-rejected punches so the employee's own timesheet matches the HR timesheet and
      // payroll (which drop them); NULL review_status (an ordinary punch) is kept.
      .or('review_status.is.null,review_status.neq.rejected'),
    service
      .from('hr_timesheet_overrides')
      .select('business_date, worked_min, late_min, ot_min, absent, reason')
      .eq('user_id', user.id)
      .gte('business_date', from)
      .lte('business_date', to),
  ]);
  // Include empRes.error: a genuine query failure must 500, not silently fall back to the
  // default hours/eligibility (which would mis-compute OT). A legitimately MISSING row
  // (data null, error null) still uses the conservative defaults below.
  if (empRes.error || scheduleRes.error || attendanceRes.error || overridesRes.error) {
    return NextResponse.json({ error: 'Failed to load timesheet' }, { status: 500 });
  }

  const emp = empRes.data as { work_hours_per_day: number | null; ot_eligible: boolean | null; company_id: string | null } | null;
  const workHours = emp?.work_hours_per_day ?? DEFAULT_WORK_HOURS;
  const otEligible = emp?.ot_eligible ?? false;


  const schedule = (scheduleRes.data ?? []) as unknown as ScheduleCell[];
  const attendance = (attendanceRes.data ?? []) as AttendanceRow[];
  const overrides = (overridesRes.data ?? []) as OverrideRow[];
  const overrideByDate = new Map<string, TimesheetOverride>(
    overrides.map((o) => [
      o.business_date,
      { worked_min: o.worked_min, late_min: o.late_min, ot_min: o.ot_min, absent: o.absent, reason: o.reason },
    ])
  );
  const schedByDate = new Map(schedule.map((s) => [s.work_date, s]));
  const punchesByDate = new Map<string, Punch[]>();
  for (const a of attendance) {
    const list = punchesByDate.get(a.business_date) ?? [];
    list.push({ type: a.type, ts: a.ts });
    punchesByDate.set(a.business_date, list);
  }

  const days: DaySummary[] = dates.map((date) => {
    const cell = schedByDate.get(date);
    const derived = computeDaySummary({
      businessDate: date,
      shift: cell?.shift ?? null,
      isDayOff: cell?.is_day_off ?? false,
      hasSchedule: !!cell,
      punches: punchesByDate.get(date) ?? [],
      workHoursPerDay: workHours,
      otEligible,
      closedThrough: CLOSED_THROUGH(),
    });
    return applyOverride(derived, overrideByDate.get(date));
  });

  // score_config: the owner-tunable work-index knobs so the client card scores with the same
  // rules HR sees (defaults = historical constants when no policy rows exist).
  const scoreConfig = (await getHrPolicies(service)).work_index;
  return NextResponse.json({ from, to, work_hours_per_day: workHours, ot_eligible: otEligible, days, totals: sumDays(days), score_config: scoreConfig });
}
