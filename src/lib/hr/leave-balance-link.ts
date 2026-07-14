import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Staged leave-balance materialization (migration 00166).
 *
 * The SALARY sheet import stages vacation balances for people who exist only in
 * hr_pending_identities (no app account yet) into hr_pending_leave_balances.
 * When that identity is finally linked to a real hr_employees row (self-register,
 * identity-claim approve, or HR add-employee prefill), call this to copy the
 * staged rows into hr_leave_balances and stamp them consumed.
 *
 * Best-effort by design: NEVER throws — a leave-balance hiccup must not break
 * onboarding. Failures are logged and reflected in the returned counts.
 */

export interface ApplyPendingLeaveBalancesInput {
  pendingIdentityId: string;
  employeeId: string;
  /** the new employee's company — used to resolve company-scoped leave types */
  companyId: string | null;
}

export interface ApplyPendingLeaveBalancesResult {
  /** unconsumed staged rows found for the identity */
  staged: number;
  /** rows upserted into hr_leave_balances and stamped consumed */
  applied: number;
  /** rows skipped (no matching leave type, or a write failed) */
  skipped: number;
}

interface StagedRow {
  id: string;
  leave_type_code: string;
  year: number;
  quota_days: number;
  note: string | null;
}

interface LeaveTypeRow {
  id: string;
  company_id: string | null;
  code: string;
}

export async function applyPendingLeaveBalances(
  service: SupabaseClient,
  { pendingIdentityId, employeeId, companyId }: ApplyPendingLeaveBalancesInput
): Promise<ApplyPendingLeaveBalancesResult> {
  const result: ApplyPendingLeaveBalancesResult = { staged: 0, applied: 0, skipped: 0 };
  try {
    const { data: stagedRows, error: stagedErr } = await service
      .from('hr_pending_leave_balances')
      .select('id, leave_type_code, year, quota_days, note')
      .eq('pending_identity_id', pendingIdentityId)
      .is('consumed_at', null);
    if (stagedErr) {
      console.error('[leave-balance-link] failed to load staged balances:', stagedErr.message);
      return result;
    }
    const staged = (stagedRows ?? []) as StagedRow[];
    result.staged = staged.length;
    if (!staged.length) return result;

    // Resolve each staged code to a leave type: company-scoped wins, else shared (company_id null).
    const codes = [...new Set(staged.map((r) => r.leave_type_code))];
    const { data: typeRows, error: typeErr } = await service
      .from('hr_leave_types')
      .select('id, company_id, code')
      .in('code', codes);
    if (typeErr) {
      console.error('[leave-balance-link] failed to load leave types:', typeErr.message);
      result.skipped = staged.length;
      return result;
    }
    const types = (typeRows ?? []) as LeaveTypeRow[];
    const typeIdFor = (code: string): string | null => {
      if (companyId) {
        const scoped = types.find((t) => t.code === code && t.company_id === companyId);
        if (scoped) return scoped.id;
      }
      return types.find((t) => t.code === code && t.company_id === null)?.id ?? null;
    };

    for (const row of staged) {
      const leaveTypeId = typeIdFor(row.leave_type_code);
      if (!leaveTypeId) {
        console.error(
          `[leave-balance-link] no '${row.leave_type_code}' leave type for company ${companyId ?? '(none)'} — staged row ${row.id} left unconsumed`
        );
        result.skipped++;
        continue;
      }
      const { error: upsertErr } = await service
        .from('hr_leave_balances')
        .upsert(
          {
            employee_id: employeeId,
            leave_type_id: leaveTypeId,
            year: row.year,
            quota_days: row.quota_days,
            note: row.note,
          },
          { onConflict: 'employee_id,leave_type_id,year' }
        );
      if (upsertErr) {
        console.error(`[leave-balance-link] upsert failed for staged row ${row.id}:`, upsertErr.message);
        result.skipped++;
        continue;
      }
      const { error: consumeErr } = await service
        .from('hr_pending_leave_balances')
        .update({ consumed_at: new Date().toISOString(), consumed_employee_id: employeeId })
        .eq('id', row.id);
      if (consumeErr) {
        // balance is in place — just the consumed stamp failed; log so it can be reconciled
        console.error(`[leave-balance-link] consumed stamp failed for staged row ${row.id}:`, consumeErr.message);
      }
      result.applied++;
    }
    return result;
  } catch (e) {
    console.error('[leave-balance-link] unexpected failure:', e);
    return result;
  }
}
