import { NextResponse } from 'next/server';
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
import { buildLeaveSummary } from '@/lib/hr/leave-summary';

const DEFAULT_WORK_HOURS = 9;
const PAY_HISTORY_MONTHS = 6;

interface ScheduleCell {
  work_date: string;
  is_day_off: boolean;
  status: string;
  shift: { label: string | null; start_time: string; end_time: string } | null;
}
interface AttendanceRow {
  type: Punch['type'];
  ts: string;
  business_date: string;
}
interface OverrideRow {
  business_date: string;
  worked_min: number | null;
  late_min: number | null;
  ot_min: number | null;
  absent: boolean | null;
  reason: string | null;
}
interface PayPoint {
  period_year: number;
  period_month: number;
  net_satang: number;
  gross_satang: number;
  tax_satang: number;
  sso_satang: number;
  source: 'payrun' | 'imported';
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
// The pay cycle runs the 26th → 25th.
function cycleRange(today: string): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number);
  const startMs = d >= 26 ? Date.UTC(y, m - 1, 26) : Date.UTC(y, m - 2, 26);
  const from = new Date(startMs).toISOString().slice(0, 10);
  const [fy, fm] = from.split('-').map(Number);
  const to = new Date(Date.UTC(fy, fm, 25)).toISOString().slice(0, 10);
  return { from, to };
}

// GET /api/hr/ess/dashboard — everything the /me summary cards need in ONE round-trip
// (today's live attendance state, this pay-cycle totals, latest pay + history, latest
// finalized SC allocation, leave quotas, stock penalties). Auth-any, strictly self-scoped;
// all money stays integer satang.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const today = openBusinessDateBangkok();
  const { from: cycleFrom, to: cycleTo } = cycleRange(today);
  const year = Number(today.slice(0, 4));
  const nextShiftHorizon = addDays(today, 21);

  const { data: empRow, error: empErr } = await service
    .from('hr_employees')
    .select('id, company_id, work_hours_per_day, ot_eligible')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to load employee' }, { status: 500 });
  const emp = empRow as { id: string; company_id: string | null; work_hours_per_day: number | null; ot_eligible: boolean | null } | null;

  const [scheduleRes, futureRes, attendanceRes, overridesRes, slipRes, penaltiesRes] = await Promise.all([
    // Cycle schedule: NO status filter, same as the ESS timesheet route, so totals match it.
    service
      .from('hr_schedule')
      .select('work_date, is_day_off, status, shift:hr_shift_templates(label, start_time, end_time)')
      .eq('user_id', user.id)
      .gte('work_date', cycleFrom)
      .lte('work_date', today),
    // Upcoming shifts: published only (the employee must not see a draft roster).
    service
      .from('hr_schedule')
      .select('work_date, is_day_off, status, shift:hr_shift_templates(label, start_time, end_time)')
      .eq('user_id', user.id)
      .in('status', ['submitted', 'acknowledged'])
      .gt('work_date', today)
      .lte('work_date', nextShiftHorizon)
      .order('work_date'),
    service
      .from('hr_attendance')
      .select('type, ts, business_date')
      .eq('user_id', user.id)
      .gte('business_date', cycleFrom)
      .lte('business_date', today)
      .or('review_status.is.null,review_status.neq.rejected'),
    service
      .from('hr_timesheet_overrides')
      .select('business_date, worked_min, late_min, ot_min, absent, reason')
      .eq('user_id', user.id)
      .gte('business_date', cycleFrom)
      .lte('business_date', today),
    service
      .from('hr_payslips')
      .select('id, payrun_id, gross_satang, net_satang, sso_satang, tax_satang')
      .eq('user_id', user.id),
    service
      .from('penalties')
      .select('amount, status, month_year, included_in_quota')
      .eq('staff_id', user.id)
      .eq('month_year', today.slice(0, 7)),
  ]);
  if (scheduleRes.error || futureRes.error || attendanceRes.error || overridesRes.error || slipRes.error || penaltiesRes.error) {
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }

  // ---- Today + cycle totals (same engine as the ESS timesheet) ----
  const workHours = emp?.work_hours_per_day ?? DEFAULT_WORK_HOURS;
  const otEligible = emp?.ot_eligible ?? false;
  const schedule = (scheduleRes.data ?? []) as unknown as ScheduleCell[];
  const schedByDate = new Map(schedule.map((s) => [s.work_date, s]));
  const overrideByDate = new Map<string, TimesheetOverride>(
    ((overridesRes.data ?? []) as OverrideRow[]).map((o) => [
      o.business_date,
      { worked_min: o.worked_min, late_min: o.late_min, ot_min: o.ot_min, absent: o.absent, reason: o.reason },
    ])
  );
  const punchesByDate = new Map<string, Punch[]>();
  for (const a of (attendanceRes.data ?? []) as AttendanceRow[]) {
    const list = punchesByDate.get(a.business_date) ?? [];
    list.push({ type: a.type, ts: a.ts });
    punchesByDate.set(a.business_date, list);
  }
  const days: DaySummary[] = [];
  let scheduledDays = 0;
  for (let date = cycleFrom; date <= today; date = addDays(date, 1)) {
    const cell = schedByDate.get(date);
    const derived = computeDaySummary({
      businessDate: date,
      shift: cell?.shift ?? null,
      isDayOff: cell?.is_day_off ?? false,
      hasSchedule: !!cell,
      punches: punchesByDate.get(date) ?? [],
      workHoursPerDay: workHours,
      otEligible,
    });
    const day = applyOverride(derived, overrideByDate.get(date));
    days.push(day);
    if (day.scheduled) scheduledDays += 1;
  }
  const todaySummary = days[days.length - 1] ?? null;
  const todayCell = schedByDate.get(today);
  const nextShiftCell = ((futureRes.data ?? []) as unknown as ScheduleCell[]).find((c) => !c.is_day_off && c.shift);
  // Last punch today → lets the client tell "on duty" from "on break" (break_start vs break_end).
  const todayPunches = (punchesByDate.get(today) ?? []).slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const lastPunch = todayPunches[todayPunches.length - 1] ?? null;

  // ---- Pay history: finalized payruns + imported legacy slips, merged per period ----
  const slips = slipRes.data ?? [];
  const payrunIds = [...new Set(slips.map((s) => s.payrun_id))];
  const [runRes, importedRes, scAllocRes] = await Promise.all([
    payrunIds.length
      ? service.from('hr_payruns').select('id, period_year, period_month, pay_date, status').in('id', payrunIds).eq('status', 'finalized')
      : Promise.resolve({ data: [], error: null }),
    emp?.id
      ? service
          .from('hr_imported_payslips')
          .select('period_year, period_month, gross_satang, net_satang, sso5_satang, tax_satang')
          .eq('employee_id', emp.id)
      : Promise.resolve({ data: [], error: null }),
    service
      .from('hr_sc_allocations')
      .select('pool_id, allocated_satang, deductions:hr_sc_deductions(amount_satang)')
      .eq('user_id', user.id),
  ]);
  if (runRes.error || importedRes.error || scAllocRes.error) {
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }

  const runById = new Map((runRes.data ?? []).map((r) => [r.id as string, r]));
  const byPeriod = new Map<string, PayPoint>();
  // Imported first, then real payruns — a real (finalized) slip wins over a legacy import.
  for (const row of importedRes.data ?? []) {
    const key = `${row.period_year}-${row.period_month}`;
    byPeriod.set(key, {
      period_year: Number(row.period_year),
      period_month: Number(row.period_month),
      net_satang: Number(row.net_satang ?? 0),
      gross_satang: Number(row.gross_satang ?? 0),
      tax_satang: Number(row.tax_satang ?? 0),
      sso_satang: Number(row.sso5_satang ?? 0),
      source: 'imported',
    });
  }
  let latestPayDate: string | null = null;
  let latestKey: string | null = null;
  for (const s of slips) {
    const run = runById.get(s.payrun_id as string);
    if (!run) continue;
    const key = `${run.period_year}-${run.period_month}`;
    byPeriod.set(key, {
      period_year: Number(run.period_year),
      period_month: Number(run.period_month),
      net_satang: Number(s.net_satang ?? 0),
      gross_satang: Number(s.gross_satang ?? 0),
      tax_satang: Number(s.tax_satang ?? 0),
      sso_satang: Number(s.sso_satang ?? 0),
      source: 'payrun',
    });
    if (!latestKey || byPeriod.get(latestKey)!.period_year * 100 + byPeriod.get(latestKey)!.period_month < Number(run.period_year) * 100 + Number(run.period_month)) {
      latestKey = key;
      latestPayDate = (run.pay_date as string | null) ?? null;
    }
  }
  const payPoints = [...byPeriod.values()].sort(
    (a, b) => a.period_year * 100 + a.period_month - (b.period_year * 100 + b.period_month)
  );
  const latest = payPoints.length ? payPoints[payPoints.length - 1] : null;
  const history = payPoints.slice(-PAY_HISTORY_MONTHS).map((p) => ({
    period_year: p.period_year,
    period_month: p.period_month,
    net_satang: p.net_satang,
  }));
  const ytdPoints = payPoints.filter((p) => p.period_year === year);
  const ytd = {
    months: ytdPoints.length,
    net_satang: ytdPoints.reduce((s, p) => s + p.net_satang, 0),
    gross_satang: ytdPoints.reduce((s, p) => s + p.gross_satang, 0),
    tax_satang: ytdPoints.reduce((s, p) => s + p.tax_satang, 0),
    sso_satang: ytdPoints.reduce((s, p) => s + p.sso_satang, 0),
  };

  // ---- Latest finalized SC allocation (two-step: an embedded status filter on the pool
  // hangs the PostgREST planner — same workaround as /api/hr/ess/payslips) ----
  let sc: { period_month: string; pay_date: string | null; announced_at: string | null; net_satang: number } | null = null;
  const allocs = scAllocRes.data ?? [];
  if (allocs.length) {
    const poolIds = [...new Set(allocs.map((a) => a.pool_id as string))];
    const { data: pools } = await service
      .from('hr_sc_pools')
      .select('id, period_month, pay_date, status, announced_at')
      .in('id', poolIds)
      .eq('status', 'finalized');
    const poolById = new Map((pools ?? []).map((p) => [p.id as string, p]));
    const finalized = allocs
      .filter((a) => poolById.has(a.pool_id as string))
      .map((a) => {
        const pool = poolById.get(a.pool_id as string)!;
        const deducted = ((a.deductions ?? []) as { amount_satang: number }[]).reduce((s, d) => s + Number(d.amount_satang || 0), 0);
        return {
          period_month: pool.period_month as string,
          pay_date: (pool.pay_date as string | null) ?? null,
          announced_at: (pool.announced_at as string | null) ?? null,
          net_satang: Math.max(0, Number(a.allocated_satang) - deducted),
        };
      })
      .sort((a, b) => (a.period_month < b.period_month ? 1 : -1));
    sc = finalized[0] ?? null;
  }

  // ---- Leave quotas (shared builder) + stock penalties this month ----
  const leave = emp?.id && emp.company_id
    ? await buildLeaveSummary(service, user.id, { id: emp.id, company_id: emp.company_id }, year)
    : null;
  const penaltyRows = (penaltiesRes.data ?? []).filter((r) => r.status !== 'cancelled');
  const penalties = {
    month_points: penaltyRows.filter((r) => r.included_in_quota === true).length,
    month_baht: penaltyRows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
  };

  return NextResponse.json({
    data: {
      today: todaySummary,
      today_last_punch: lastPunch ? { type: lastPunch.type, ts: lastPunch.ts } : null,
      today_shift: todayCell && !todayCell.is_day_off ? todayCell.shift : null,
      next_shift: nextShiftCell ? { work_date: nextShiftCell.work_date, ...nextShiftCell.shift! } : null,
      cycle: { from: cycleFrom, to: cycleTo, scheduled_days: scheduledDays, totals: sumDays(days) },
      pay: {
        latest: latest
          ? { period_year: latest.period_year, period_month: latest.period_month, net_satang: latest.net_satang, source: latest.source, pay_date: latest.source === 'payrun' ? latestPayDate : null }
          : null,
        history,
        ytd,
        sc,
      },
      leave,
      penalties,
    },
  });
}
