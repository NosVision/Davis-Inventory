// Shared validation for recurring payroll items (hr_employee_recurring, v2 per 00162).
// Period windows are 'YYYY-MM' strings matching hr_payruns (period_year, period_month);
// zero-padded text compare is the whole date math.

export const RECURRING_EARNING_CODES = ['cost_of_living', 'housing', 'phone', 'travel', 'holiday_comp', 'other'] as const;
export const RECURRING_DEDUCTION_CODES = ['student_loan', 'advance', 'guarantee', 'loan', 'other'] as const;
/** Every valid `code` value (DB CHECK 00162 mirrors this list). */
export const RECURRING_CODES: string[] = [...new Set([...RECURRING_EARNING_CODES, ...RECURRING_DEDUCTION_CODES])];

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export type PeriodInputResult =
  | { ok: true; start_period: string | null; end_period: string | null }
  | { ok: false; error: string };

/** Parse optional start_period/end_period from a request body ('' and null → null = open side). */
export function parsePeriodInput(body: Record<string, unknown>): PeriodInputResult {
  const norm = (v: unknown): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    return typeof v === 'string' ? v.trim() : String(v);
  };
  const start = norm(body.start_period);
  const end = norm(body.end_period);
  if (start != null && !PERIOD_RE.test(start)) return { ok: false, error: 'start_period must be YYYY-MM' };
  if (end != null && !PERIOD_RE.test(end)) return { ok: false, error: 'end_period must be YYYY-MM' };
  if (start != null && end != null && end < start) {
    return { ok: false, error: 'end_period must not be before start_period' };
  }
  return { ok: true, start_period: start ?? null, end_period: end ?? null };
}
