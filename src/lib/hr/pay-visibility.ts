/**
 * Who may see whose pay.
 *
 * A second HR user needs to run HR — including payroll for most people — without seeing what a
 * named handful earn (owner ask 2026-08-08). `hr_employees.pay_confidential` marks those people;
 * `can_view_confidential_pay` is the grant that lifts the veil.
 *
 * The rule is "hide the NUMBERS, not the PERSON": a confidential employee stays fully visible for
 * leave, scheduling, attendance and documents — otherwise the restricted HR user could not do
 * their job for that person at all. Only money is gated.
 *
 * Everything here is server-side on purpose. Hiding a column in the UI is not access control:
 * the same figures leak through the payslip API, the payrun total, the bank file, the tax reports,
 * the accountant review link and the audit log, and each of those is closed at its own route.
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

/** profiles.id of every employee whose pay is confidential. Empty set = nothing to hide. */
export async function confidentialProfileIds(service: SupabaseClient): Promise<Set<string>> {
  const { data } = await service
    .from('hr_employees')
    .select('profile_id')
    .eq('pay_confidential', true);
  return new Set((data ?? []).map((e) => e.profile_id as string));
}

/** hr_employees.id of every employee whose pay is confidential. */
export async function confidentialEmployeeIds(service: SupabaseClient): Promise<Set<string>> {
  const { data } = await service
    .from('hr_employees')
    .select('id')
    .eq('pay_confidential', true);
  return new Set((data ?? []).map((e) => e.id as string));
}

/** Money fields stripped from an employee row the caller may not see the pay of. */
export const REDACTED_EMPLOYEE_PAY = {
  rate_satang: null,
  bank_name: null,
  bank_account_no: null,
  bank_account_name: null,
  pay_confidential: true,
  pay_hidden: true,
} as const;

/**
 * Blank the pay fields on employee rows the caller may not see, leaving everything else — the
 * person still appears in the register, just without their numbers.
 */
export function redactEmployeePay<T extends Record<string, unknown>>(
  rows: readonly T[],
  allowed: boolean
): T[] {
  if (allowed) return [...rows];
  return rows.map((r) => (r.pay_confidential ? { ...r, ...REDACTED_EMPLOYEE_PAY } : r));
}

/**
 * Guard for surfaces that cannot be partially redacted and so must be refused outright:
 * ภ.ง.ด.1 / สปส. / ใบ 50 ทวิ / ทะเบียนค่าจ้าง (legally must list everyone), the bank transfer file,
 * and the accountant review link (whose whole point is to expose the full payrun).
 *
 * Returns null when the caller may proceed, or the reason to refuse with.
 */
export async function refuseIfConfidentialInScope(
  service: SupabaseClient,
  userId: string,
  profileIdsInScope: readonly string[]
): Promise<string | null> {
  if (await callerCanViewConfidentialPay(service, userId)) return null;
  const confidential = await confidentialProfileIds(service);
  if (confidential.size === 0) return null;
  const hit = profileIdsInScope.some((id) => confidential.has(id));
  return hit
    ? 'เอกสารนี้ต้องแสดงข้อมูลพนักงานครบทุกคน จึงตัดคนที่ปิดข้อมูลเงินเดือนออกไม่ได้ — ต้องให้ผู้ที่มีสิทธิ์ดูข้อมูลเงินเดือนลับเป็นผู้ออก'
    : null;
}
