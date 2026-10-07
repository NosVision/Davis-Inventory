/**
 * When an employee record may be deleted outright, rather than marked resigned.
 *
 * Only a duplicate that never did anything: a second record a person registered for themselves
 * (client report 2026-10-08 — the same staffer under @tunmoewin and @earth), whose login HR has
 * already disabled. Anything with history — a punch, a leave, a payslip, an imported slip, a linked
 * sheet identity — is someone's employment record and stays; for those the answer is to resign
 * them, not erase them.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type DeleteBlocker =
  | 'login_active'
  | 'attendance'
  | 'attendance_requests'
  | 'leaves'
  | 'payslips'
  | 'imported_payslips'
  | 'linked_identity'
  | 'leave_balances'
  | 'tax_allowances'
  | 'recurring_pay';

export const DELETE_BLOCKER_TH: Record<DeleteBlocker, string> = {
  login_active: 'บัญชีผู้ใช้ยังเปิดใช้งานอยู่ — ปิดใช้งานก่อน',
  attendance: 'มีประวัติลงเวลา',
  attendance_requests: 'มีคำขอแก้เวลา',
  leaves: 'มีประวัติการลา',
  payslips: 'มีสลิปเงินเดือน',
  imported_payslips: 'มีสลิปเงินเดือนย้อนหลังที่นำเข้า',
  linked_identity: 'ผูกกับรายชื่อจากไฟล์เงินเดือนแล้ว',
  leave_balances: 'มีโควตาวันลา',
  tax_allowances: 'มีข้อมูลลดหย่อนภาษี',
  recurring_pay: 'มีรายการเงินเพิ่ม/หักประจำ',
};

async function hasAny(
  service: SupabaseClient,
  table: string,
  column: string,
  value: string
): Promise<boolean> {
  const { count, error } = await service
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (count ?? 0) > 0;
}

/** Every reason this record may not be deleted; an empty list means it may. */
export async function findDeleteBlockers(
  service: SupabaseClient,
  employee: { id: string; profile_id: string; profile_active: boolean | null }
): Promise<DeleteBlocker[]> {
  const checks: [DeleteBlocker, Promise<boolean>][] = [
    ['attendance', hasAny(service, 'hr_attendance', 'user_id', employee.profile_id)],
    ['attendance_requests', hasAny(service, 'hr_attendance_requests', 'user_id', employee.profile_id)],
    ['leaves', hasAny(service, 'hr_leaves', 'user_id', employee.profile_id)],
    ['payslips', hasAny(service, 'hr_payslips', 'employee_id', employee.id)],
    ['imported_payslips', hasAny(service, 'hr_imported_payslips', 'employee_id', employee.id)],
    ['linked_identity', hasAny(service, 'hr_pending_identities', 'linked_employee_id', employee.id)],
    // These three cascade with the record — deleting it would erase them without a trace.
    ['leave_balances', hasAny(service, 'hr_leave_balances', 'employee_id', employee.id)],
    ['tax_allowances', hasAny(service, 'hr_tax_allowances', 'employee_id', employee.id)],
    ['recurring_pay', hasAny(service, 'hr_employee_recurring', 'employee_id', employee.id)],
  ];
  const results = await Promise.all(checks.map(([, p]) => p));
  const blockers = checks.filter((_, i) => results[i]).map(([b]) => b);
  return employee.profile_active === false ? blockers : ['login_active', ...blockers];
}
