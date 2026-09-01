/**
 * The quota numbers behind one leave request, loaded the same way for all three paths that can
 * create or approve leave: the employee filing it (ESS), HR keying it in on their behalf, and the
 * manager or HR approving it.
 *
 * They used to disagree. ESS checked the quota; HR's own form checked nothing at all, so a request
 * keyed in from /hr/leaves sailed past a limit the same request would have been refused for from
 * /me/leaves. And nobody re-checked at APPROVAL, which is the moment that actually spends the days:
 * two requests filed while there was room could both be approved after there was not.
 *
 * Pending requests count. A request sitting in the queue has effectively claimed its days — the
 * alternative is telling someone their leave is fine, then refusing it a week later because a
 * colleague's request was approved first.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PendingLeaveRef } from '@/lib/hr/leaves';

export interface LeaveQuotaContext {
  /** The employee's own override for the year, else the type's default. null = unlimited. */
  effectiveQuota: number | null;
  /** Days of this type already approved in the year. */
  approved: number;
  /**
   * Days of this type already taken this year BEFORE the app recorded leave (00199) — the
   * Jan–Jun 2026 figures from the imported payroll slips. They are spent just as surely as an
   * approved request; leaving them out told sixteen people they still had their whole vacation.
   */
  usedBeforeSystem: number;
  /** Requests of this type still in the queue, named by their dates. */
  pending: PendingLeaveRef[];
}

export interface LeaveQuotaLookup {
  /** hr_employees.id — the per-person override is keyed on this. */
  employeeId: string;
  /** profiles.id — hr_leaves is keyed on this. */
  profileId: string;
  leaveTypeId: string;
  /** The type's own annual_quota_days, used when the employee has no override. */
  typeQuotaDays: number | null;
  year: number;
  /** Approving a request must not count that request as pending against itself. */
  excludeLeaveId?: string;
}

export async function loadLeaveQuotaContext(
  service: SupabaseClient,
  lookup: LeaveQuotaLookup
): Promise<LeaveQuotaContext> {
  const from = `${lookup.year}-01-01`;
  const to = `${lookup.year}-12-31`;

  const [balanceRes, leavesRes] = await Promise.all([
    service
      .from('hr_leave_balances')
      .select('quota_days, used_before_system_days')
      .eq('employee_id', lookup.employeeId)
      .eq('leave_type_id', lookup.leaveTypeId)
      .eq('year', lookup.year)
      .maybeSingle(),
    service
      .from('hr_leaves')
      .select('id, from_date, to_date, days, status')
      .eq('user_id', lookup.profileId)
      .eq('leave_type_id', lookup.leaveTypeId)
      .in('status', ['approved', 'pending'])
      .gte('from_date', from)
      .lte('from_date', to),
  ]);

  // quota_days is NULLable since 00199: a row may exist only to carry used_before_system_days,
  // and then the company default still applies.
  const balance = balanceRes.data as { quota_days: number | null; used_before_system_days: number | null } | null;
  const effectiveQuota = balance?.quota_days != null ? Number(balance.quota_days) : lookup.typeQuotaDays;
  const usedBeforeSystem = Math.round(Number(balance?.used_before_system_days ?? 0) * 10) / 10;

  let approved = 0;
  const pending: PendingLeaveRef[] = [];
  for (const row of (leavesRes.data ?? []) as {
    id: string;
    from_date: string;
    to_date: string;
    days: number | null;
    status: string;
  }[]) {
    if (row.id === lookup.excludeLeaveId) continue;
    const days = Number(row.days ?? 0);
    if (row.status === 'approved') approved += days;
    else pending.push({ from_date: row.from_date, to_date: row.to_date, days });
  }

  pending.sort((a, b) => a.from_date.localeCompare(b.from_date));
  return { effectiveQuota, approved: Math.round(approved * 10) / 10, usedBeforeSystem, pending };
}
