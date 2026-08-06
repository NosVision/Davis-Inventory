import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope } from '@/lib/hr/route-auth';
import { openBusinessDateBangkok } from '@/lib/utils/date';
import {
  computeDaySummary,
  applyOverride,
  type Punch,
  type TimesheetOverride,
} from '@/lib/hr/time-engine';
import { computeAttendanceScore, type AttendanceScore } from '@/lib/hr/attendance-score';
import { getHrPolicies } from '@/lib/hr/policy';
import { businessDateBangkok } from '@/lib/utils/date';

// Last business day that has CLOSED. A rostered day after this is still ahead of us, so it must
// never count as an absence (see time-engine's closedThrough).
const CLOSED_THROUGH = () => businessDateBangkok();

// GET /api/hr/attendance-index?user_ids=a,b,c&from&to — the work index (attendance score) for a
// SET of employees at once, cross-store, for HR surfaces that aren't store-scoped (e.g. the
// evaluation results table). Same time-engine reconciliation as the timesheet routes + the same
// pure scoring lib as the ESS card, restricted to PAST business days so a mid-month period never
// shows diluted scores. Scoped: a store-limited manager only gets users of their stores.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 62;
const MAX_USERS = 100;
const DEFAULT_WORK_HOURS = 9;

interface ScheduleCell {
  user_id: string;
  work_date: string;
  is_day_off: boolean;
  shift: { start_time: string; end_time: string } | null;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const sp = request.nextUrl.searchParams;
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to || addDays(from, MAX_RANGE_DAYS) < to) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
  }
  let userIds = (sp.get('user_ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_USERS);
  if (userIds.length === 0) return NextResponse.json({ data: {} });

  const service = createServiceClient();

  // Scoped manager → silently drop out-of-scope users (the eval table may mix stores).
  if (scope.storeIds) {
    const { data: us, error } = await service.from('user_stores').select('user_id').in('store_id', scope.storeIds);
    if (error) return NextResponse.json({ error: 'Scope lookup failed' }, { status: 500 });
    const allowed = new Set((us ?? []).map((r) => r.user_id as string));
    userIds = userIds.filter((u) => allowed.has(u));
    if (userIds.length === 0) return NextResponse.json({ data: {} });
  }

  // Past business days only — same rule as the ESS card.
  const today = openBusinessDateBangkok();
  const effTo = to < today ? to : today;
  if (from > effTo) return NextResponse.json({ data: {} });
  const dates: string[] = [];
  for (let d = from; d <= effTo; d = addDays(d, 1)) dates.push(d);

  const [empRes, schedRes, attRes, ovrRes] = await Promise.all([
    service.from('hr_employees').select('profile_id, work_hours_per_day, ot_eligible').in('profile_id', userIds),
    service
      .from('hr_schedule')
      .select('user_id, work_date, is_day_off, shift:hr_shift_templates(start_time, end_time)')
      .in('user_id', userIds)
      .gte('work_date', from)
      .lte('work_date', effTo),
    service
      .from('hr_attendance')
      .select('user_id, type, ts, business_date')
      .in('user_id', userIds)
      .gte('business_date', from)
      .lte('business_date', effTo),
    service
      .from('hr_timesheet_overrides')
      .select('user_id, business_date, worked_min, late_min, ot_min, absent, reason')
      .in('user_id', userIds)
      .gte('business_date', from)
      .lte('business_date', effTo),
  ]);
  if (empRes.error || schedRes.error || attRes.error || ovrRes.error) {
    return NextResponse.json({ error: 'Failed to load attendance' }, { status: 500 });
  }

  const empByUser = new Map(
    ((empRes.data ?? []) as { profile_id: string; work_hours_per_day: number | null; ot_eligible: boolean | null }[]).map(
      (e) => [e.profile_id, e]
    )
  );
  const schedByUser = new Map<string, Map<string, ScheduleCell>>();
  for (const s of (schedRes.data ?? []) as unknown as ScheduleCell[]) {
    const m = schedByUser.get(s.user_id) ?? new Map<string, ScheduleCell>();
    m.set(s.work_date, s);
    schedByUser.set(s.user_id, m);
  }
  const punchByUser = new Map<string, Map<string, Punch[]>>();
  for (const a of (attRes.data ?? []) as { user_id: string; type: Punch['type']; ts: string; business_date: string }[]) {
    const m = punchByUser.get(a.user_id) ?? new Map<string, Punch[]>();
    const list = m.get(a.business_date) ?? [];
    list.push({ type: a.type, ts: a.ts });
    m.set(a.business_date, list);
    punchByUser.set(a.user_id, m);
  }
  const ovrByUser = new Map<string, Map<string, TimesheetOverride>>();
  for (const o of (ovrRes.data ?? []) as {
    user_id: string; business_date: string; worked_min: number | null; late_min: number | null;
    ot_min: number | null; absent: boolean | null; reason: string | null;
  }[]) {
    const m = ovrByUser.get(o.user_id) ?? new Map<string, TimesheetOverride>();
    m.set(o.business_date, { worked_min: o.worked_min, late_min: o.late_min, ot_min: o.ot_min, absent: o.absent, reason: o.reason });
    ovrByUser.set(o.user_id, m);
  }

  const scoreCfg = (await getHrPolicies(service)).work_index;
  const out: Record<string, AttendanceScore> = {};
  for (const uid of userIds) {
    const emp = empByUser.get(uid);
    const sched = schedByUser.get(uid);
    const punches = punchByUser.get(uid);
    const ovr = ovrByUser.get(uid);
    let scheduledDays = 0, absentDays = 0, lateDays = 0, lateMinutes = 0, incompleteDays = 0, otMinutes = 0;
    for (const date of dates) {
      const cell = sched?.get(date);
      const day = applyOverride(
        computeDaySummary({
          businessDate: date,
          shift: cell?.shift ?? null,
          isDayOff: cell?.is_day_off ?? false,
          hasSchedule: !!cell,
          punches: punches?.get(date) ?? [],
          workHoursPerDay: emp?.work_hours_per_day ?? DEFAULT_WORK_HOURS,
          otEligible: emp?.ot_eligible ?? false,
          closedThrough: CLOSED_THROUGH(),
        }),
        ovr?.get(date)
      );
      otMinutes += day.ot_min ?? 0;
      if (!day.scheduled || day.is_day_off) continue;
      scheduledDays++;
      if (day.absent) absentDays++;
      if ((day.late_min ?? 0) > 0) { lateDays++; lateMinutes += day.late_min ?? 0; }
      if (day.incomplete && !day.absent) incompleteDays++;
    }
    const score = computeAttendanceScore({ scheduledDays, absentDays, lateDays, lateMinutes, incompleteDays, otMinutes }, scoreCfg);
    if (score) out[uid] = score;
  }

  return NextResponse.json({ data: out, from, to: effTo });
}
