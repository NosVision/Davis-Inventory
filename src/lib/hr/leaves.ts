// HR Leave Types (P3.1)
// Leave status and type enums for type safety

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  user_id: string;
  store_id: string | null;
  company_id: string;
  leave_type_id: string;
  from_date: string; // YYYY-MM-DD
  to_date: string; // YYYY-MM-DD
  days: number; // Can be 0.5 for half-day
  reason: string;
  cert_path: string | null;
  status: LeaveStatus;
  approver_id: string | null;
  decided_at: string | null;
  decision_note: string | null;
  // Overridden fields (set by HR when adjusting timesheet)
  worked_min_override: number | null;
  late_min_override: number | null;
  ot_min_override: number | null;
  absent_override: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLeaveRequest {
  leave_type_id: string;
  from_date: string; // YYYY-MM-DD
  to_date: string; // YYYY-MM-DD
  days: number;
  reason: string;
  cert_file?: File; // Upload for medical certificate
}

export interface UpdateLeaveStatus {
  status: 'approved' | 'rejected';
  decision_note?: string;
  // Optionally override timesheet fields when approving
  worked_min_override?: number;
  late_min_override?: number;
  ot_min_override?: number;
  absent_override?: boolean;
}

export interface LeaveType {
  id: string;
  company_id: string;
  code: string;
  name_th: string;
  name_en: string;
  paid: boolean;
  requires_cert: boolean;
  requires_reason: boolean;
  annual_quota_days: number | null;
  max_consecutive_days: number | null;
  probational_allowed: boolean;
  advance_notice_days: number | null;
  paid_percent: number | null;
  sort_order: number;
  active: boolean;
  // Effect config (00169) — drives pay/cert behavior instead of hardcoded codes.
  deduct_sc: boolean; // dock the day's Service-Charge share
  deduct_travel: boolean; // dock the monthly travel allowance per day
  paid_with_cert: boolean; // salary preserved when a cert is provided (e.g. sick)
  cert_threshold_days: number | null; // requires_cert only beyond N days (null = always)
}

export interface Holiday {
  id: string;
  company_id: string;
  holiday_date: string; // YYYY-MM-DD
  name_th: string;
  name_en: string;
  is_public_holiday: boolean;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Leave engine (pure) — §D validation + §E/§H pay-effect classification.
// Money is NOT computed here (that is P4 payroll); this only produces the
// per-leave classification and day counts that payroll will consume.
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date, not just the shape (rejects 2026-02-30). */
export function isCalendarDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

/** Inclusive list of YYYY-MM-DD strings from `from` to `to` (deterministic, UTC math). */
export function enumerateDates(from: string, to: string): string[] {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return [];
  const out: string[] = [];
  let cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  // guard against absurd ranges
  let guard = 0;
  while (cur.getTime() <= end.getTime() && guard < 400) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86_400_000);
    guard++;
  }
  return out;
}

/**
 * Count leave days in [from, to] inclusive, excluding any dates passed in `excluded`.
 * Roster day-offs are handled at approval time against hr_schedule, since a leave may be filed
 * for future dates that have no roster row yet. Public holidays were retired as a concept on
 * 2026-08-18 — the roster is the only record of whether a day was a working day.
 */
export function countLeaveDays(from: string, to: string, excluded: Iterable<string> = []): number {
  const skip = excluded instanceof Set ? excluded : new Set(excluded);
  return enumerateDates(from, to).filter((d) => !skip.has(d)).length;
}

/**
 * Whether a medical/other certificate is required for this leave — driven by config (00169),
 * not by code. When `requires_cert` is set, a `cert_threshold_days` (e.g. 3 for sick) means the
 * cert is needed only beyond that many days; a null threshold means it is always required.
 */
export function isCertRequired(
  leaveType: Pick<LeaveType, 'requires_cert' | 'cert_threshold_days'>,
  days: number,
): boolean {
  if (!leaveType.requires_cert) return false;
  if (leaveType.cert_threshold_days != null) return days > leaveType.cert_threshold_days;
  return true;
}

/**
 * §E/§H leave pay-effect classification — the "3-column result" that payroll (P4)
 * consumes. Each flag says whether that dimension is DEDUCTED for the leave day:
 *   - deductSalary : salary docked ÷30/day (an unpaid/absent day)
 *   - deductSc     : the day's Service-Charge share is docked
 *   - deductTravel : the monthly travel allowance is not paid for the day
 *
 * Driven entirely by config columns (00169), not by code:
 *   - deductSalary ← salary is docked unless the type is `paid`, OR it is `paid_with_cert` and a
 *     valid cert was provided (the sick-with-cert rule).
 *   - deductSc / deductTravel ← the type's `deduct_sc` / `deduct_travel` flags (SC and the travel
 *     allowance are presence-based, so a leave day can dock them even when salary is preserved).
 *
 * §H table (Davis handbook), now expressed as config on each type:
 *   ลากิจ / ลาป่วยไม่มีใบรับรอง (= absent)  → salary หัก · SC หัก · travel หัก
 *   ลาป่วยมีใบรับรองถูกต้อง                → salary ไม่หัก · SC หัก · travel หัก  (paid_with_cert)
 *   พักร้อน / PH                          → ไม่หัก ทั้งหมด
 */
export interface LeaveEffect {
  paid: boolean;
  deductSalary: boolean;
  deductSc: boolean;
  deductTravel: boolean;
}

export function classifyLeaveEffect(
  leaveType: Pick<LeaveType, 'paid' | 'paid_with_cert' | 'deduct_sc' | 'deduct_travel'>,
  hasCert: boolean,
): LeaveEffect {
  const paid = leaveType.paid || (leaveType.paid_with_cert && hasCert);
  return {
    paid,
    deductSalary: !paid,
    deductSc: leaveType.deduct_sc,
    deductTravel: leaveType.deduct_travel,
  };
}

export interface LeaveValidationInput {
  leaveType: LeaveType;
  fromDate: string;
  toDate: string;
  days: number;
  hasCert: boolean;
  /** Today (YYYY-MM-DD, Bangkok) — for advance-notice checks. */
  today: string;
  /** Employee is still within their 119-day probation. */
  isProbation: boolean;
  /** Days of this leave type already used this year (for quota checks). */
  usedDaysThisYear?: number;
}

export interface LeaveValidationResult {
  ok: boolean;
  error?: string;
  code?:
    | 'invalid_date'
    | 'range_order'
    | 'inactive_type'
    | 'probation_blocked'
    | 'cert_required'
    | 'advance_notice'
    | 'quota_exceeded'
    | 'max_consecutive';
}

/** Days between two YYYY-MM-DD (b - a), by UTC math. */
function dayDiff(a: string, b: string): number {
  const ta = new Date(`${a}T00:00:00Z`).getTime();
  const tb = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((tb - ta) / 86_400_000);
}

/**
 * Validate a leave request against §D rules. Pure — the caller supplies `today`,
 * probation state, holiday-adjusted `days`, and (optionally) used-quota. Returns the
 * first failing rule so the UI can show a specific message.
 */
export function validateLeaveRequest(input: LeaveValidationInput): LeaveValidationResult {
  const { leaveType, fromDate, toDate, days, hasCert, today, isProbation } = input;

  if (!isCalendarDate(fromDate) || !isCalendarDate(toDate)) {
    return { ok: false, code: 'invalid_date', error: 'Invalid leave dates' };
  }
  if (dayDiff(fromDate, toDate) < 0) {
    return { ok: false, code: 'range_order', error: 'to_date must be on or after from_date' };
  }
  if (!leaveType.active) {
    return { ok: false, code: 'inactive_type', error: 'This leave type is not active' };
  }
  if (isProbation && !leaveType.probational_allowed) {
    return {
      ok: false,
      code: 'probation_blocked',
      error: 'This leave type is not allowed during probation',
    };
  }
  if (isCertRequired(leaveType, days) && !hasCert) {
    return {
      ok: false,
      code: 'cert_required',
      error: 'A supporting certificate is required for this leave',
    };
  }
  if (leaveType.advance_notice_days && leaveType.advance_notice_days > 0) {
    const notice = dayDiff(today, fromDate);
    if (notice < leaveType.advance_notice_days) {
      return {
        ok: false,
        code: 'advance_notice',
        error: `This leave requires at least ${leaveType.advance_notice_days} days advance notice`,
      };
    }
  }
  if (
    leaveType.max_consecutive_days &&
    leaveType.max_consecutive_days > 0 &&
    days > leaveType.max_consecutive_days
  ) {
    return {
      ok: false,
      code: 'max_consecutive',
      error: `This leave allows at most ${leaveType.max_consecutive_days} consecutive days`,
    };
  }
  if (
    leaveType.annual_quota_days != null &&
    input.usedDaysThisYear != null &&
    input.usedDaysThisYear + days > leaveType.annual_quota_days
  ) {
    return {
      ok: false,
      code: 'quota_exceeded',
      error: `This exceeds the annual quota of ${leaveType.annual_quota_days} days for this leave type`,
    };
  }
  return { ok: true };
}
