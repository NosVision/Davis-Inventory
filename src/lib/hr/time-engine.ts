/**
 * Time engine (§A / §F / §I): reconcile a day's attendance punches against the scheduled
 * shift into raw time metrics — late / absent / OT / break minutes.
 *
 * This computes MINUTES and FLAGS only. Money (late-deduction tiers, OT multipliers,
 * holiday pay) is deliberately NOT here — that is payroll (P4), which consumes these
 * numbers. Keeping the engine money-free keeps it pure and testable.
 *
 * Business day: a person's punches are grouped by `business_date` (the 6am-cutoff day the
 * check-in route already stamps), so an overnight shift's in (e.g. 17:00) and out (01:00)
 * fall on the same business day as the scheduled cell (work_date). All timestamps are
 * absolute instants (timestamptz), compared in UTC; scheduled times are Bangkok wall-clock.
 */

const MS_PER_MIN = 60_000;
const BANGKOK_OFFSET = '+07:00';
const MORNING_CUTOFF_HOUR = 6; // shift start_times before 06:00 occur on the NEXT calendar day

export type PunchType = 'in' | 'out' | 'break_start' | 'break_end';

export interface Punch {
  type: PunchType;
  ts: string; // ISO timestamptz
}

export interface ShiftInfo {
  start_time: string; // 'HH:MM' or 'HH:MM:SS'
  end_time: string;
}

export interface DaySummaryInput {
  businessDate: string; // 'YYYY-MM-DD'
  shift: ShiftInfo | null; // the scheduled shift template, when it's a working day
  isDayOff: boolean; // an explicit scheduled day off
  hasSchedule: boolean; // any hr_schedule row exists for this (user, date)
  punches: Punch[];
  workHoursPerDay: number; // hr_employees.work_hours_per_day (8 | 9)
  otEligible: boolean;
}

export interface DaySummary {
  business_date: string;
  scheduled: boolean; // scheduled to work (has a shift, not a day off)
  is_day_off: boolean;
  first_in: string | null;
  last_out: string | null;
  worked_min: number | null; // clock span minus break; null when it can't be finalized
  break_min: number;
  late_min: number | null; // vs the scheduled start; null when not scheduled or no in-punch
  ot_min: number; // worked beyond the person's own hours, only when ot_eligible
  absent: boolean; // scheduled work day with no in-punch
  incomplete: boolean; // has an in-punch but no out-punch (worked can't be finalized)
  worked_on_day_off: boolean; // punched in on a scheduled day off
  overridden: boolean; // an HR override was applied over the derived values
  override_reason: string | null; // the reason HR gave for the override
}

/** An HR-entered override; null fields fall through to the derived value (§J8/§B). */
export interface TimesheetOverride {
  worked_min: number | null;
  late_min: number | null;
  ot_min: number | null;
  absent: boolean | null;
  reason: string | null;
}

/**
 * Layer an HR override's non-null fields over a derived day (immutable). The punches
 * are never touched — this only affects the reported metrics. Always flags `overridden`
 * when a row exists so the UI can show it, even if the row only carries a reason/note.
 */
export function applyOverride(
  day: DaySummary,
  override: TimesheetOverride | undefined
): DaySummary {
  if (!override) return day;
  return {
    ...day,
    worked_min: override.worked_min !== null ? override.worked_min : day.worked_min,
    late_min: override.late_min !== null ? override.late_min : day.late_min,
    ot_min: override.ot_min !== null ? override.ot_min : day.ot_min,
    absent: override.absent !== null ? override.absent : day.absent,
    overridden: true,
    override_reason: override.reason ?? null,
  };
}

interface Interval {
  start: number; // epoch ms
  end: number;
}

function minutesBetween(later: string, earlier: string): number {
  return (new Date(later).getTime() - new Date(earlier).getTime()) / MS_PER_MIN;
}

/**
 * Pair an open→close punch stream into intervals (in→out, or break_start→break_end),
 * ignoring unmatched/repeated events so a stray tap can't widen a span. Returns the
 * paired intervals plus whether a final open event was left unclosed (still clocked in).
 */
function pairIntervals(
  punches: Punch[],
  openType: PunchType,
  closeType: PunchType
): { intervals: Interval[]; openAtEnd: boolean } {
  const events = punches
    .filter((p) => p.type === openType || p.type === closeType)
    .map((p) => ({ type: p.type, ms: new Date(p.ts).getTime() }))
    .sort((a, b) => a.ms - b.ms);
  const intervals: Interval[] = [];
  let open: number | null = null;
  for (const e of events) {
    if (e.type === openType) {
      if (open === null) open = e.ms; // ignore a repeated open until it's closed
    } else if (open !== null) {
      if (e.ms > open) intervals.push({ start: open, end: e.ms });
      open = null;
    }
  }
  return { intervals, openAtEnd: open !== null };
}

function totalMinutes(iv: Interval[]): number {
  return iv.reduce((sum, i) => sum + (i.end - i.start), 0) / MS_PER_MIN;
}

/** Total overlap (minutes) between two interval sets — used to count only the break time
 *  that actually falls inside a worked interval, so out-of-span breaks don't over-subtract. */
function overlapMinutes(a: Interval[], b: Interval[]): number {
  let total = 0;
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) total += end - start;
    }
  }
  return total / MS_PER_MIN;
}

/** 'HH:MM[:SS]' → 'HH:MM'. */
function hhmm(t: string): string {
  return t.length >= 5 ? t.slice(0, 5) : '00:00';
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * The absolute instant of the scheduled shift start. A start_time before 06:00 belongs to
 * the next calendar day within the same business day (e.g. a 02:00 start on business day D
 * happens at D+1 02:00); a start_time ≥ 06:00 is on business day D itself.
 */
function scheduledStartInstant(businessDate: string, startTime: string): string {
  const hm = hhmm(startTime);
  const hour = Number(hm.slice(0, 2));
  const calDate = hour < MORNING_CUTOFF_HOUR ? addDays(businessDate, 1) : businessDate;
  return `${calDate}T${hm}:00${BANGKOK_OFFSET}`;
}

/**
 * Reconcile one employee-day. Pure: no I/O, no clock reads.
 *
 * worked = sum of paired in→out intervals (NOT the outer span), so an out→in gap in the
 * middle of the day is not billed; break minutes are counted only where they overlap a
 * worked interval, so a stray break outside the clocked span can't over-subtract.
 */
export function computeDaySummary(input: DaySummaryInput): DaySummary {
  const ins = input.punches
    .filter((p) => p.type === 'in')
    .map((p) => p.ts)
    .sort();
  const outs = input.punches
    .filter((p) => p.type === 'out')
    .map((p) => p.ts)
    .sort();

  const firstIn = ins[0] ?? null;
  const lastOut = outs.length ? outs[outs.length - 1] : null;
  const scheduled = input.hasSchedule && !input.isDayOff && input.shift !== null;

  const { intervals: workedIv, openAtEnd } = pairIntervals(input.punches, 'in', 'out');
  const { intervals: breakIv } = pairIntervals(input.punches, 'break_start', 'break_end');
  const breakMin = Math.max(0, Math.round(overlapMinutes(breakIv, workedIv)));

  let workedMin: number | null = null;
  let incomplete = false;
  if (workedIv.length > 0) {
    workedMin = Math.max(0, Math.round(totalMinutes(workedIv) - overlapMinutes(breakIv, workedIv)));
    if (openAtEnd) incomplete = true; // some pairs closed, but still clocked in
  } else if (firstIn) {
    incomplete = true; // clocked in, never completed an out — can't finalize worked
  }

  let lateMin: number | null = null;
  if (scheduled && input.shift && firstIn) {
    const startInstant = scheduledStartInstant(input.businessDate, input.shift.start_time);
    lateMin = Math.max(0, Math.round(minutesBetween(firstIn, startInstant)));
  }

  const absent = scheduled && !firstIn;

  // OT only accrues for eligible employees, past THEIR OWN daily hours. Non-eligible
  // employees who work longer get nothing extra (their Nth hour is already in salary).
  let otMin = 0;
  if (input.otEligible && workedMin !== null) {
    otMin = Math.max(0, workedMin - input.workHoursPerDay * 60);
  }

  return {
    business_date: input.businessDate,
    scheduled,
    is_day_off: input.isDayOff,
    first_in: firstIn,
    last_out: lastOut,
    worked_min: workedMin,
    break_min: breakMin,
    late_min: lateMin,
    ot_min: otMin,
    absent,
    incomplete,
    worked_on_day_off: input.isDayOff && !!firstIn,
    overridden: false,
    override_reason: null,
  };
}

export interface TimesheetTotals {
  work_days: number; // days with an in-punch
  absent_days: number;
  late_days: number; // days with late_min > 0
  worked_min: number;
  ot_min: number;
  late_min: number;
  break_min: number;
}

/** Roll a set of day summaries into per-employee totals. */
export function sumDays(days: DaySummary[]): TimesheetTotals {
  return days.reduce<TimesheetTotals>(
    (acc, d) => ({
      // A worked day = punched in, OR an HR override credited working minutes (bulk backfill /
      // manual entry) even without a punch.
      work_days: acc.work_days + (d.first_in || (d.worked_min ?? 0) > 0 ? 1 : 0),
      absent_days: acc.absent_days + (d.absent ? 1 : 0),
      late_days: acc.late_days + ((d.late_min ?? 0) > 0 ? 1 : 0),
      worked_min: acc.worked_min + (d.worked_min ?? 0),
      ot_min: acc.ot_min + d.ot_min,
      late_min: acc.late_min + (d.late_min ?? 0),
      break_min: acc.break_min + d.break_min,
    }),
    { work_days: 0, absent_days: 0, late_days: 0, worked_min: 0, ot_min: 0, late_min: 0, break_min: 0 }
  );
}
