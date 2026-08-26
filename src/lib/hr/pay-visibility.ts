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

/** profiles.id of every employee whose pay is hidden from this caller. Empty = nothing to hide. */
export async function payHiddenProfileIds(
  service: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const visibility = await loadPayVisibility(service, userId);
  if (visibility.canViewAll) return new Set();

  const { data } = await service
    .from('hr_employees')
    .select('profile_id, pay_confidential, payroll_group_id');
  const hidden = new Set<string>();
  for (const e of (data ?? []) as {
    profile_id: string | null;
    pay_confidential: boolean | null;
    payroll_group_id: string | null;
  }[]) {
    if (e.profile_id && isPayHiddenFrom(e, visibility)) hidden.add(e.profile_id);
  }
  return hidden;
}

/** Money fields stripped from an employee row the caller may not see the pay of. */
export const REDACTED_EMPLOYEE_PAY = {
  rate_satang: null,
  bank_name: null,
  bank_account_no: null,
  bank_account_name: null,
  pay_hidden: true,
} as const;

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
