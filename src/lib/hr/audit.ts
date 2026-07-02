import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * HR audit log helper (§B of HR-PLAN).
 *
 * Writes to the dedicated `hr_audit_log` table (separate from the general
 * `audit_logs` used by `@/lib/audit`). Every hr_* mutation should record a row
 * with before/after snapshots so HR/owner can see an edit history per record.
 *
 * Call from server routes that already hold a service-role client
 * (`createServiceClient()` from `@/lib/supabase/server`) — the RLS insert policy
 * only allows self-attributed rows, and the service client bypasses RLS.
 */

export type HrAuditAction = 'create' | 'update' | 'delete';

export interface HrAuditParams {
  /** profiles.id of the acting user (null for system actions) */
  actorId: string | null;
  action: HrAuditAction;
  /** hr_* table name the change applies to, e.g. 'hr_employees' */
  table: string;
  recordId?: string | null;
  before?: unknown;
  after?: unknown;
  /** required for sensitive changes (rate, bank, payrun reopen, deductions) */
  reason?: string | null;
}

/**
 * Insert one hr_audit_log row. Fire-and-forget: never throws — an HR mutation
 * must never fail because auditing failed.
 */
export async function logHrAudit(
  service: SupabaseClient,
  params: HrAuditParams
): Promise<void> {
  try {
    await service.from('hr_audit_log').insert({
      actor_id: params.actorId,
      action: params.action,
      table_name: params.table,
      record_id: params.recordId ?? null,
      before: params.before ?? null,
      after: params.after ?? null,
      reason: params.reason ?? null,
    });
  } catch {
    // never block a mutation on audit failure
  }
}
