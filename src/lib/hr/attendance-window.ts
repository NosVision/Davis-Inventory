/**
 * Attendance is a RECORD OF WHAT HAPPENED, so it can never be written for a day that hasn't
 * happened yet (owner ask 2026-08-06, after a roster published through 25/08 was mistaken for
 * clocked-in time). Punches already can't land in the future — the check-in route stamps the
 * server's own business date — but the HR override, the bulk-backfill grid and the ESS
 * correction request all accept a caller-supplied date, so they share this guard.
 *
 * What this does NOT cover, deliberately:
 *   • the roster (hr_schedule) — planning next month's shifts is the point of it
 *   • วันหยุด and ลา — both are plans people file in advance
 */

export const FUTURE_ATTENDANCE_ERROR =
  'บันทึกเวลาทำงานล่วงหน้าไม่ได้ — วันที่ยังมาไม่ถึง (จัดตารางเวรล่วงหน้าได้ตามปกติ)';

/**
 * True when `businessDate` is later than the last business day that has closed.
 *
 * Stays clock-free (like time-engine) so it can be exercised offline: callers pass
 * `businessDateBangkok()`, which is TODAY once the 6am cutoff has passed — same-day corrections
 * therefore keep working.
 */
export function isFutureAttendanceDate(businessDate: string, closedThrough: string): boolean {
  return businessDate > closedThrough;
}

// ---------------------------------------------------------------------------
// Which instants belong to a business day
// ---------------------------------------------------------------------------

/** A business day D runs [D 06:00, D+1 06:00) Bangkok — the same cutoff the whole app groups on. */
export const BUSINESS_DAY_CUTOFF_HOUR = 6;

export const OFF_BUSINESS_DATE_ERROR =
  'เวลาที่ระบุไม่ได้อยู่ในวันทำงานนั้น — วันทำงานนับ 06:00 ถึง 06:00 ของวันถัดไป';

/**
 * How far PAST the 06:00 cutoff a CLOSING punch (out / break_end) may still belong to the business
 * day it opened on.
 *
 * A night shift does not always end before dawn. Someone who clocked in at 18:30 and left at 10:30
 * the next morning had no way to file that correction at all: 10:30 pasted onto the business date
 * lands nine hours BEFORE their own check-in, and the strict [06:00, 06:00) window refused the only
 * instant that made sense (owner report 2026-09-02). The live check-in route already accepts such a
 * punch — it adopts a late clock-out onto the previous business date for up to 3h past the rostered
 * shift end — so the correction path was the stricter of the two for no reason.
 *
 * Six hours (→ 12:00 the next day) is the bound: it covers a night shift that ran into the morning
 * without letting an out punch drift into the following evening's own shift.
 */
export const CLOSING_PUNCH_TAIL_HOURS = 6;

export const OFF_BUSINESS_DATE_OUT_ERROR =
  'เวลาออกงานไม่ได้อยู่ในกะของวันทำงานนั้น — ออกงานได้ถึง 12:00 ของวันถัดไป';

export const OUT_BEFORE_IN_ERROR =
  'เวลาออกงานต้องอยู่หลังเวลาเข้างานของวันนั้น';

/**
 * The longest single stretch a check-in → check-out pair may claim.
 *
 * The widened closing window is bounded by the CLOCK (next day 12:00), which is the right bound
 * for a night shift but a loose one for a morning shift: someone who clocked in at 08:00 and typed
 * "07:00" means 07:00 yesterday, yet the only reading left is 07:00 tomorrow — a 23-hour day that
 * payroll would pay, OT and all. Anything past 20 hours is a typo, not a shift.
 */
export const MAX_SHIFT_SPAN_HOURS = 20;

export const SHIFT_TOO_LONG_ERROR = `ช่วงเวลาทำงานยาวเกิน ${MAX_SHIFT_SPAN_HOURS} ชั่วโมง — ตรวจเวลาที่กรอกอีกครั้ง`;

/** True when out − in exceeds MAX_SHIFT_SPAN_HOURS (both instants; false when either is unusable). */
export function isSpanTooLong(inTs: string, outTs: string): boolean {
  const from = new Date(inTs).getTime();
  const to = new Date(outTs).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  return to - from > MAX_SHIFT_SPAN_HOURS * 3_600_000;
}

function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * A Bangkok wall-clock 'HH:mm' ON business day `businessDate`, as a real instant.
 *
 * The subtlety this exists for: a time before 06:00 is the small hours of the NEXT calendar day
 * while still belonging to the same business day. Naively pasting the time onto the business date
 * puts a 02:00 shift end nine hours BEFORE its own 17:00 check-in, which reads to the time engine
 * as a day that was never closed — the exact shape it is trying to fix.
 */
export function businessDayInstant(businessDate: string, hhmm: string): string {
  const hm = hhmm.slice(0, 5);
  const hour = Number(hm.slice(0, 2));
  const calDate =
    Number.isFinite(hour) && hour < BUSINESS_DAY_CUTOFF_HOUR
      ? addCalendarDays(businessDate, 1)
      : businessDate;
  return new Date(`${calDate}T${hm}:00+07:00`).toISOString();
}

/**
 * True when `ts` falls inside business day `businessDate`, i.e. [D 06:00, D+1 06:00) Bangkok.
 *
 * `closingPunch` widens the tail to D+1 12:00 for an out / break_end — see
 * CLOSING_PUNCH_TAIL_HOURS. The opening side never moves: a check-IN before 06:00 belongs to the
 * previous business day by definition, and letting one drift would silently re-date the shift.
 */
export function isInstantOnBusinessDate(
  ts: string,
  businessDate: string,
  opts: { closingPunch?: boolean } = {}
): boolean {
  const at = new Date(ts).getTime();
  if (Number.isNaN(at)) return false;
  const pad = (h: number) => String(h).padStart(2, '0');
  const endHour = BUSINESS_DAY_CUTOFF_HOUR + (opts.closingPunch ? CLOSING_PUNCH_TAIL_HOURS : 0);
  const start = new Date(`${businessDate}T${pad(BUSINESS_DAY_CUTOFF_HOUR)}:00:00+07:00`).getTime();
  const end = new Date(`${addCalendarDays(businessDate, 1)}T${pad(endHour)}:00:00+07:00`).getTime();
  return at >= start && at < end;
}

/** True for the punch types that CLOSE an interval, and so may run past the 06:00 cutoff. */
export function isClosingPunchType(type: string | null | undefined): boolean {
  return type === 'out' || type === 'break_end';
}

/**
 * The instant of Bangkok wall-clock `hhmm` that CLOSES the shift opened at `inTs` on `businessDate`.
 *
 * Same as businessDayInstant, plus the case it cannot see on its own: a time at or after 06:00 that
 * still falls before the check-in can only mean the next morning. 18:30 in, "10:30" out is not a
 * 10:30 that already happened — it is tomorrow's 10:30, sixteen hours later.
 *
 * A time BEFORE 06:00 is left where businessDayInstant put it (already the small hours of D+1).
 * Rolling that one further would turn a genuine typo into a 30-hour shift instead of an error.
 */
export function closingInstantAfter(
  businessDate: string,
  hhmm: string,
  inTs: string | null | undefined
): string {
  const first = businessDayInstant(businessDate, hhmm);
  const hour = Number(hhmm.slice(0, 2));
  if (!Number.isFinite(hour) || hour < BUSINESS_DAY_CUTOFF_HOUR) return first;
  const inAt = inTs ? new Date(inTs).getTime() : NaN;
  if (Number.isNaN(inAt) || new Date(first).getTime() > inAt) return first;
  return new Date(`${addCalendarDays(businessDate, 1)}T${hhmm.slice(0, 5)}:00+07:00`).toISOString();
}
