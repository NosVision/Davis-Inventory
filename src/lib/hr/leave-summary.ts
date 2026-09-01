import type { SupabaseClient } from '@supabase/supabase-js';

export interface LeaveTypeSummary {
  id: string;
  code: string;
  name_th: string;
  name_en: string;
  quota: number | null;
  /** Days already spent: approved requests PLUS `carried` below. */
  used: number;
  /**
   * Of `used`, the days taken this year before the app recorded leave (00199, from the imported
   * payroll slips). Called out separately because they have no request to open and no mark on the
   * month strip — otherwise the card reads "ใช้ไป 6 วัน" over an empty leave history.
   */
  carried: number;
  /** Days sitting in the approval queue — spoken for, but not yet taken. */
  pending: number;
  /** quota − used − pending. A pending request holds its days, so it must be subtracted here too,
   *  or the screen offers days that filing would immediately be refused for. */
  remaining: number | null;
}

export interface LeaveSummary {
  year: number;
  types: LeaveTypeSummary[];
  /** Total approved leave days per month across ALL types (index 0 = January). */
  monthly: number[];
}

/**
 * The caller's OWN leave quota/usage for one Bangkok year. Effective quota per type =
 * the employee's hr_leave_balances override for this year ?? the type's annual_quota_days
 * (null = unlimited). Shared by /api/hr/ess/leaves/summary and /api/hr/ess/dashboard so
 * the two never drift.
 */
export async function buildLeaveSummary(
  service: SupabaseClient,
  userId: string,
  emp: { id: string; company_id: string },
  year: number
): Promise<LeaveSummary | null> {
  const [typesRes, balancesRes, usedRes] = await Promise.all([
    service
      .from('hr_leave_types')
      .select('id, code, name_th, name_en, annual_quota_days')
      .eq('active', true)
      .or(`company_id.is.null,company_id.eq.${emp.company_id}`)
      .order('sort_order', { ascending: true }),
    service
      .from('hr_leave_balances')
      .select('leave_type_id, quota_days, used_before_system_days')
      .eq('employee_id', emp.id)
      .eq('year', year),
    service
      .from('hr_leaves')
      .select('leave_type_id, from_date, days, status')
      .eq('user_id', userId)
      .in('status', ['approved', 'pending'])
      .gte('from_date', `${year}-01-01`)
      .lte('from_date', `${year}-12-31`),
  ]);
  if (typesRes.error || balancesRes.error || usedRes.error) return null;

  // quota_days is NULLable since 00199 (a row may exist only to carry the opening used-days), so
  // a row is NOT by itself an override — read the two columns independently.
  const balanceByType = new Map<string, number>();
  const carriedByType = new Map<string, number>();
  for (const b of balancesRes.data ?? []) {
    const typeId = b.leave_type_id as string;
    if (b.quota_days != null) balanceByType.set(typeId, Number(b.quota_days));
    const carried = Number(b.used_before_system_days ?? 0);
    if (carried > 0) carriedByType.set(typeId, Math.round(carried * 10) / 10);
  }

  const usedByType = new Map<string, number>();
  const pendingByType = new Map<string, number>();
  const monthly = Array.from({ length: 12 }, () => 0);
  for (const row of usedRes.data ?? []) {
    const days = Number(row.days ?? 0);
    const typeId = row.leave_type_id as string;
    // Pending days count against the quota but are NOT leave taken — the monthly strip below
    // stays a record of what actually happened.
    if (row.status === 'pending') {
      pendingByType.set(typeId, Math.round(((pendingByType.get(typeId) ?? 0) + days) * 10) / 10);
      continue;
    }
    usedByType.set(typeId, Math.round(((usedByType.get(typeId) ?? 0) + days) * 10) / 10);
    const month = Number(String(row.from_date).slice(5, 7));
    if (month >= 1 && month <= 12) {
      monthly[month - 1] = Math.round((monthly[month - 1] + days) * 10) / 10;
    }
  }

  const types = (typesRes.data ?? []).map((t) => {
    const override = balanceByType.get(t.id as string);
    const quota = override ?? (t.annual_quota_days == null ? null : Number(t.annual_quota_days));
    const carried = carriedByType.get(t.id as string) ?? 0;
    const used = Math.round(((usedByType.get(t.id as string) ?? 0) + carried) * 10) / 10;
    const pending = pendingByType.get(t.id as string) ?? 0;
    return {
      id: t.id as string,
      code: t.code as string,
      name_th: t.name_th as string,
      name_en: t.name_en as string,
      quota,
      used,
      carried,
      pending,
      remaining: quota == null ? null : Math.round((quota - used - pending) * 10) / 10,
    };
  });

  return { year, types, monthly };
}
