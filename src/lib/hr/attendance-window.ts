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
