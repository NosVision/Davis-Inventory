/**
 * Employee domain logic (§A/§I of HR-PLAN) shared by API routes and UI.
 * Pure functions — no DB/IO.
 */

export const PAY_TYPES = ['full_monthly', 'pt_hourly', 'pt_daily', 'pt_monthly'] as const;
export const PART_TIME_PAY_TYPES = ['pt_hourly', 'pt_daily', 'pt_monthly'] as const;
export const TAX_MODES = ['progressive', 'withholding_3pct', 'none'] as const;
export const EMPLOYEE_STATUSES = ['active', 'probation', 'resigned', 'terminated'] as const;
export const WORK_HOURS_PER_DAY = [8, 9] as const;
export const OT_HOUR_DIVISORS = [8, 9] as const;
export const STANDARD_DAYS_OFF = [6, 8] as const;
export const DOCUMENT_TYPES = ['id_card', 'signature', 'contract', 'other'] as const;

/** §E: probation is 119 days from start. */
export const PROBATION_DAYS = 119;

export type PayType = (typeof PAY_TYPES)[number];
export type TaxMode = (typeof TAX_MODES)[number];
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface EmployeeDocument {
  type: DocumentType;
  path: string; // storage path in the private 'hr-documents' bucket (NOT a public url)
  name?: string;
  uploaded_at: string;
}

/** Writable hr_employees columns (excludes id/profile_id/audit cols). */
export interface EmployeeWritable {
  company_id: string | null;
  position_id: string | null;
  department_id: string | null;
  supervisor_id: string | null;
  employee_code: string | null;
  rate_satang: number;
  pay_type: PayType;
  work_hours_per_day: number;
  break_hours: number;
  ot_eligible: boolean;
  ot_hour_divisor: number;
  standard_days_off: number;
  tax_mode: TaxMode;
  sso_enrolled: boolean;
  pvd_enrolled: boolean;
  pvd_employee_rate: number;
  pvd_employer_rate: number;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  sso_no: string | null;
  tax_id: string | null;
  emergency_contact: unknown;
  documents: EmployeeDocument[];
  start_date: string | null;
  probation_end: string | null;
  birth_date: string | null;
  status: EmployeeStatus;
  end_date: string | null;
  end_reason: string | null;
  notes: string | null;
}

export function isPartTime(payType: string | null | undefined): boolean {
  return !!payType && (PART_TIME_PAY_TYPES as readonly string[]).includes(payType);
}

/**
 * §A part-time auto-profile: part-timers always get 3% withholding, no SSO, no OT.
 * Forced server-side regardless of client input. Returns a new object (immutable).
 */
export function applyPartTimeProfile<T extends { pay_type: string }>(
  fields: T
): T & { tax_mode: TaxMode; sso_enrolled: boolean; ot_eligible: boolean } {
  if (!isPartTime(fields.pay_type)) {
    return fields as T & { tax_mode: TaxMode; sso_enrolled: boolean; ot_eligible: boolean };
  }
  return { ...fields, tax_mode: 'withholding_3pct', sso_enrolled: false, ot_eligible: false };
}

/**
 * §A: part-time employees must have an ID-card copy AND a signature on file.
 * Returns an error message when the requirement is not met, else null.
 */
export function validatePartTimeDocs(
  payType: string,
  documents: EmployeeDocument[]
): string | null {
  if (!isPartTime(payType)) return null;
  const types = new Set(documents.map((d) => d.type));
  if (!types.has('id_card')) return 'Part-time employee requires an ID card copy (id_card)';
  if (!types.has('signature')) return 'Part-time employee requires a signature (signature)';
  return null;
}

/** start_date + probation days (owner-tunable via hr_policy_settings; default 119), or null. */
export function computeProbationEnd(
  startDate: string | null | undefined,
  probationDays: number = PROBATION_DAYS
): string | null {
  if (!startDate) return null;
  const d = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + probationDays);
  return d.toISOString().slice(0, 10);
}

/** Coerce/validate the documents array from untrusted input. */
export function sanitizeDocuments(input: unknown): EmployeeDocument[] {
  if (!Array.isArray(input)) return [];
  const out: EmployeeDocument[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as Record<string, unknown>;
    const type = d.type as string;
    const path = d.path as string;
    if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) continue;
    if (typeof path !== 'string' || !path) continue;
    out.push({
      type: type as DocumentType,
      path,
      name: typeof d.name === 'string' ? d.name : undefined,
      uploaded_at: typeof d.uploaded_at === 'string' ? d.uploaded_at : new Date().toISOString(),
    });
  }
  return out;
}

type FieldError = { field: string; message: string };

/**
 * Whitelist + validate writable employee fields from untrusted JSON.
 * `partial` = true for PUT (only provided keys are included; nothing defaulted).
 * Returns the picked fields (typed loosely as Record) or a list of validation errors.
 * Part-time forcing / probation defaults / doc requirements are applied by the caller
 * (which has the effective merged pay_type on update).
 */
export function pickEmployeeFields(
  raw: unknown,
  partial: boolean
): { ok: true; fields: Partial<EmployeeWritable> } | { ok: false; errors: FieldError[] } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const errors: FieldError[] = [];
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  const setEnum = (key: string, allowed: readonly (string | number)[]) => {
    if (!has(key)) return;
    const v = body[key];
    if (!allowed.includes(v as string | number)) {
      errors.push({ field: key, message: `must be one of ${allowed.join(', ')}` });
      return;
    }
    out[key] = v;
  };
  const setNumEnum = (key: string, allowed: readonly number[]) => {
    if (!has(key)) return;
    const n = Number(body[key]); // coerce "8" (form <select>) -> 8
    if (!Number.isFinite(n) || !allowed.includes(n)) {
      errors.push({ field: key, message: `must be one of ${allowed.join(', ')}` });
      return;
    }
    out[key] = n;
  };
  const setDate = (key: string) => {
    if (!has(key)) return;
    const v = body[key];
    if (v === null || v === '') {
      out[key] = null;
      return;
    }
    const s = String(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
      errors.push({ field: key, message: 'must be a valid YYYY-MM-DD date' });
      return;
    }
    out[key] = s;
  };
  const setNum = (key: string, min: number) => {
    if (!has(key)) return;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < min) {
      errors.push({ field: key, message: `must be a number >= ${min}` });
      return;
    }
    out[key] = n;
  };
  const setBool = (key: string) => {
    if (!has(key)) return;
    out[key] = Boolean(body[key]);
  };
  const setRange = (key: string, min: number, max: number) => {
    if (!has(key)) return;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < min || n > max) {
      errors.push({ field: key, message: `must be a number between ${min} and ${max}` });
      return;
    }
    out[key] = n;
  };
  const setStrOrNull = (key: string) => {
    if (!has(key)) return;
    const v = body[key];
    out[key] = v === null || v === '' ? null : String(v);
  };

  setEnum('pay_type', PAY_TYPES);
  setEnum('tax_mode', TAX_MODES);
  setEnum('status', EMPLOYEE_STATUSES);
  setNumEnum('work_hours_per_day', WORK_HOURS_PER_DAY);
  setNumEnum('ot_hour_divisor', OT_HOUR_DIVISORS);
  setNumEnum('standard_days_off', STANDARD_DAYS_OFF);
  setNum('rate_satang', 0);
  if (has('rate_satang') && out.rate_satang !== undefined) out.rate_satang = Math.round(Number(out.rate_satang));
  setNum('break_hours', 0);
  setBool('ot_eligible');
  setBool('sso_enrolled');
  setBool('pvd_enrolled');
  setRange('pvd_employee_rate', 0, 0.15); // Thai PVD 2–15% (fraction); DB CHECK also enforces
  setRange('pvd_employer_rate', 0, 0.15);
  ['company_id', 'position_id', 'department_id', 'supervisor_id'].forEach(setStrOrNull);
  ['start_date', 'probation_end', 'end_date', 'birth_date'].forEach(setDate);
  ['employee_code', 'bank_name', 'bank_account_no', 'bank_account_name', 'sso_no', 'tax_id',
    'end_reason', 'notes'].forEach(setStrOrNull);
  if (has('emergency_contact')) out.emergency_contact = body.emergency_contact ?? null;
  if (has('documents')) out.documents = sanitizeDocuments(body.documents);

  if (errors.length > 0) return { ok: false, errors };

  // For create, ensure a pay_type is set (default full_monthly) so downstream logic is defined.
  if (!partial && out.pay_type === undefined) out.pay_type = 'full_monthly';

  return { ok: true, fields: out as Partial<EmployeeWritable> };
}
