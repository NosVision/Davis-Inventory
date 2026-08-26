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

export const OUT_BEFORE_IN_ERROR =
  'เวลาออกงานต้องอยู่หลังเวลาเข้างานของวันนั้น';

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

/** True when `ts` falls inside business day `businessDate`, i.e. [D 06:00, D+1 06:00) Bangkok. */
export function isInstantOnBusinessDate(ts: string, businessDate: string): boolean {
  const at = new Date(ts).getTime();
  if (Number.isNaN(at)) return false;
  const pad = String(BUSINESS_DAY_CUTOFF_HOUR).padStart(2, '0');
  const start = new Date(`${businessDate}T${pad}:00:00+07:00`).getTime();
  const end = new Date(`${addCalendarDays(businessDate, 1)}T${pad}:00:00+07:00`).getTime();
  return at >= start && at < end;
}
