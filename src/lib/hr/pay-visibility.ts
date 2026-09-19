/**
 * Who may see whose pay.
 *
 * Two independent locks, OR'd together. An employee's figures are hidden from a caller when:
 *
 *   1. `hr_employees.pay_confidential` is set and the caller lacks `can_view_confidential_pay`
 *      (owner ask 2026-08-08) — a named handful whose salaries a second HR user must not see.
 *   2. the employee sits in a payroll group that HAS managers and the caller is not one of them
 *      (owner ask 2026-08-26) — per-group ownership, so two HR users can each run their own slice
 *      without seeing into the other's.
 *
 * `can_view_confidential_pay` outranks both: it is the grant that files the company's taxes, and
 * ภ.ง.ด.1 / สปส. / ทะเบียนค่าจ้าง list every employee anyway. See the note on
 * refuseIfConfidentialInScope for why group managers deliberately do NOT satisfy that gate.
 *
 * A group with no managers listed is unrestricted — any HR user may run it, exactly as before the
 * feature existed. "ยังไม่จัดกลุ่ม" can never be restricted: it is the absence of a group.
 *
 * The rule is "hide the NUMBERS, not the PERSON": a hidden employee stays fully visible for leave,
 * scheduling, attendance and documents — otherwise the restricted HR user could not do their job
 * for that person at all. Only money is gated.
 *
 * Everything here is server-side on purpose. Hiding a column in the UI is not access control: the
 * same figures leak through the payslip API, the payrun total, the bank file, the tax reports, the
 * accountant review link and the audit log, and each of those is closed at its own route.
 *
 * `isPayHiddenFrom` mirrors the SQL `pay_hidden_from_caller()` (migration 00195) exactly. If one
 * changes, the other must.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const CONFIDENTIAL_PAY_PERMISSION = 'can_view_confidential_pay';

/** Mirrors the SQL can_view_confidential_pay() so app and RLS agree. */
export function canViewConfidentialPay(user: {
  role: string;
  permissions: readonly string[];
}): boolean {
  return user.role === 'owner' || user.permissions.includes(CONFIDENTIAL_PAY_PERMISSION);
}

/** Look the caller's grant up from their id — for routes that only hold a user id. */
export async function callerCanViewConfidentialPay(
  service: SupabaseClient,
  userId: string
): Promise<boolean> {
  const [{ data: profile }, { data: perms }] = await Promise.all([
    service.from('profiles').select('role').eq('id', userId).maybeSingle(),
    service.from('user_permissions').select('permission').eq('user_id', userId),
  ]);
  return canViewConfidentialPay({
    role: (profile?.role as string) ?? '',
    permissions: (perms ?? []).map((p) => p.permission as string),
  });
}

/** Everything the rule needs about one caller, loaded once per request. */
export interface PayVisibility {
  /** Holds can_view_confidential_pay (or is owner) — sees every salary, everywhere. */
  canViewAll: boolean;
  /** Payroll groups this caller is listed as a manager of. */
  managedGroupIds: ReadonlySet<string>;
  /** Payroll groups that have at least one manager, i.e. are restricted at all. */
  restrictedGroupIds: ReadonlySet<string>;
}

/** A caller who may see everything — for call sites that already know the answer. */
export const PAY_VISIBILITY_ALL: PayVisibility = {
  canViewAll: true,
  managedGroupIds: new Set(),
  restrictedGroupIds: new Set(),
};

/**
 * The rule itself. Pure and synchronous so it can be asserted without a database
 * (scripts/hr-misc-assert.cjs) and applied to a list of rows without a query per row.
 */
export function isPayHiddenFrom(
  employee: { pay_confidential?: boolean | null; payroll_group_id?: string | null },
  visibility: PayVisibility
): boolean {
  if (visibility.canViewAll) return false;
  if (employee.pay_confidential) return true;
  const groupId = employee.payroll_group_id;
  if (!groupId) return false;
  if (!visibility.restrictedGroupIds.has(groupId)) return false;
  return !visibility.managedGroupIds.has(groupId);
}

/** Load one caller's visibility. Two small queries, skipped entirely when they may see everything. */
export async function loadPayVisibility(
  service: SupabaseClient,
  userId: string
): Promise<PayVisibility> {
  if (await callerCanViewConfidentialPay(service, userId)) return PAY_VISIBILITY_ALL;

  const { data } = await service.from('hr_payroll_group_managers').select('group_id, user_id');
  const rows = (data ?? []) as { group_id: string; user_id: string }[];
  const restrictedGroupIds = new Set(rows.map((r) => r.group_id));
  const managedGroupIds = new Set(rows.filter((r) => r.user_id === userId).map((r) => r.group_id));
  return { canViewAll: false, managedGroupIds, restrictedGroupIds };
}

/**
 * The employee rows whose pay is hidden from this caller. Throws when the lookup fails: an empty
 * result has to mean "nothing to hide", never "could not tell", or one database blip would open every
 * salary to every HR user.
 */
async function loadPayHiddenEmployees(
  service: SupabaseClient,
  userId: string
): Promise<{ id: string; profile_id: string | null }[]> {
  const visibility = await loadPayVisibility(service, userId);
  if (visibility.canViewAll) return [];

  const { data, error } = await service
    .from('hr_employees')
    .select('id, profile_id, pay_confidential, payroll_group_id');
  if (error) throw new Error(`pay visibility lookup failed: ${error.message}`);
  return (
    (data ?? []) as {
      id: string;
      profile_id: string | null;
      pay_confidential: boolean | null;
      payroll_group_id: string | null;
    }[]
  ).filter((e) => isPayHiddenFrom(e, visibility));
}

/** profiles.id of every employee whose pay is hidden from this caller. Empty = nothing to hide. */
export async function payHiddenProfileIds(
  service: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const hidden = await loadPayHiddenEmployees(service, userId);
  return new Set(hidden.flatMap((e) => (e.profile_id ? [e.profile_id] : [])));
}

/**
 * hr_employees.id of every employee whose pay is hidden from this caller — for tables keyed by the
 * employee row rather than the login (the imported legacy payslips).
 */
export async function payHiddenEmployeeIds(
  service: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const hidden = await loadPayHiddenEmployees(service, userId);
  return new Set(hidden.map((e) => e.id));
}

/**
 * The hr_employees columns that ARE the pay — the one list every layer redacts by.
 *
 * Widened on 2026-09-19 from the four money/bank fields to everything a payslip is computed from
 * or paid into: the redacted row still carried tax_mode, the SSO/tax ids, the PVD rates and the
 * bank-verification stamp, and a second HR user could read all of it off the detail modal and the
 * profile PDF (client: คุณต๊ะ/คุณเมย์ 2026-08-11, 2026-09-11/14/16 — "ทีมบัญชี's pay, nowhere").
 *
 * NOT here, on purpose: pay_type and sso_enrolled. They are structural (monthly vs hourly, in the
 * scheme or not) and every roster, filter and schedule screen keys on them; hiding them would
 * hide the PERSON, which the rule forbids. pay_confidential / payroll_group_id are the lock's own
 * inputs and stay readable so the form can round-trip a save.
 *
 * Mirrored by migration 20260919100000_hr_employees_pay_column_grants.sql, which revokes exactly
 * these columns from `authenticated` (scripts/test-pay-visibility.cjs asserts the two lists match).
 */
export const EMPLOYEE_PAY_COLUMNS = [
  'rate_satang',
  'bank_name',
  'bank_account_no',
  'bank_account_name',
  'bank_verified',
  'bank_verified_at',
  'bank_verified_by',
  'sso_no',
  'tax_id',
  'tax_mode',
  'pvd_enrolled',
  'pvd_employee_rate',
  'pvd_employer_rate',
] as const;
export type EmployeePayColumn = (typeof EMPLOYEE_PAY_COLUMNS)[number];

/** Money fields stripped from an employee row the caller may not see the pay of. */
export const REDACTED_EMPLOYEE_PAY: Readonly<Record<EmployeePayColumn, null> & { pay_hidden: true }> = {
  ...(Object.fromEntries(EMPLOYEE_PAY_COLUMNS.map((c) => [c, null])) as Record<EmployeePayColumn, null>),
  pay_hidden: true,
};

/**
 * Blank every `bank_*` key of a profile-change-request payload (current_value / new_value of a
 * `bank_account` request). The request queue is the one place bank details travel OUTSIDE an
 * hr_employees row, so redactEmployeePay never sees them — and the diff card showed a hidden
 * employee's old and new account numbers side by side to any HR user (found 2026-09-19).
 * Non-bank keys are kept; a null/absent payload stays as it was.
 */
export function redactBankKeys<T extends Record<string, unknown> | null | undefined>(value: T): T {
  if (!value) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, k.startsWith('bank_') ? null : v])
  ) as T;
}

/**
 * Blank the pay fields on employee rows the caller may not see, leaving everything else — the
 * person still appears in the register, just without their numbers.
 *
 * `pay_hidden` is what the UI keys on. It is set for BOTH locks, so a screen never has to know
 * which one fired; `pay_confidential` is left as it really is, because the employee form needs the
 * flag's true value to round-trip a save.
 */
export function redactEmployeePay<T extends Record<string, unknown>>(
  rows: readonly T[],
  visibility: PayVisibility
): T[] {
  if (visibility.canViewAll) return [...rows];
  return rows.map((r) =>
    isPayHiddenFrom(
      {
        pay_confidential: r.pay_confidential as boolean | null,
        payroll_group_id: r.payroll_group_id as string | null,
      },
      visibility
    )
      ? { ...r, ...REDACTED_EMPLOYEE_PAY }
      : r
  );
}

/**
 * Guard for surfaces that cannot be partially redacted and so must be refused outright:
 * ภ.ง.ด.1 / สปส. / ใบ 50 ทวิ / ทะเบียนค่าจ้าง (legally must list everyone), the bank transfer file,
 * and the accountant review link (whose whole point is to expose the full payrun).
 *
 * Note what this means for the company-wide filings, which span EVERY payroll group: being a
 * group's manager does not help you here, because the other groups are still hidden from you. That
 * is deliberate — a filing missing half the company is not a redacted filing, it is a false one.
 * The consequence, accepted by the owner on 2026-08-26: whoever holds can_view_confidential_pay
 * files the taxes and therefore sees every group's salaries. There is no version of ภ.ง.ด.1 that
 * leaves people out, so somebody has to be that person.
 *
 * Returns null when the caller may proceed, or the reason to refuse with.
 */
export async function refuseIfConfidentialInScope(
  service: SupabaseClient,
  userId: string,
  profileIdsInScope: readonly string[]
): Promise<string | null> {
  const hidden = await payHiddenProfileIds(service, userId);
  if (hidden.size === 0) return null;
  const hit = profileIdsInScope.some((id) => hidden.has(id));
  return hit
    ? 'เอกสารนี้ต้องแสดงพนักงานครบทุกคน จึงตัดคนที่คุณไม่มีสิทธิ์ดูเงินเดือนออกไม่ได้ — ต้องให้ผู้ที่ดูเงินเดือนได้ทุกคนเป็นผู้ออก'
    : null;
}
