/**
 * Undo what approving a leave wrote to the timesheet, so cancelling an approved leave really
 * gives the days back.
 *
 * Approval (api/hr/leaves/[id]/decide) upserts an hr_timesheet_overrides row on every scheduled
 * work day of the leave — a full paid day, or `absent` for unpaid leave — tagged
 * `Leave approved (paid|unpaid): CODE`, and audits the row it replaced. Flipping the leave to
 * `cancelled` alone left those rows behind: a cancelled paid leave still counted as a worked day,
 * and a cancelled unpaid one turned into an unauthorized absence (docked, SC included) because no
 * leave covered it any more.
 *
 * Only rows still carrying the approval's tag are touched. If HR edited the day by hand after
 * approving, the tag is gone and their edit stands.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logHrAudit } from './audit';
import { enumerateDates } from './leaves';

const OVERRIDE_TABLE = 'hr_timesheet_overrides';
const OVERRIDE_COLS =
  'id, user_id, business_date, store_id, worked_min, late_min, ot_min, absent, note, reason, edited_by';
export const LEAVE_OVERRIDE_TAG = 'Leave approved (';

interface OverrideRow {
  id: string;
  business_date: string;
  store_id: string | null;
  worked_min: number | null;
  late_min: number | null;
  ot_min: number | null;
  absent: boolean | null;
  note: string | null;
  reason: string | null;
}

/** The row approval replaced, from the approval's own audit entry; null when it created the row. */
async function rowBeforeApproval(service: SupabaseClient, row: OverrideRow): Promise<OverrideRow | null> {
  const { data, error } = await service
    .from('hr_audit_log')
    .select('before')
    .eq('table_name', OVERRIDE_TABLE)
    .eq('record_id', row.id)
    .eq('reason', row.reason ?? '')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.before as OverrideRow | null) ?? null;
}

export interface RevertResult {
  revertedDays: number;
  warnings: string[];
}

export async function revertLeaveOverrides(
  service: SupabaseClient,
  leave: { id: string; user_id: string; from_date: string; to_date: string },
  actorId: string
): Promise<RevertResult> {
  const warnings: string[] = [];
  let revertedDays = 0;

  const { data, error } = await service
    .from(OVERRIDE_TABLE)
    .select(OVERRIDE_COLS)
    .eq('user_id', leave.user_id)
    .gte('business_date', leave.from_date)
    .lte('business_date', leave.to_date)
    .like('reason', `${LEAVE_OVERRIDE_TAG}%`);
  if (error) return { revertedDays: 0, warnings: ['Could not read the timesheet for these days'] };

  const days = new Set(enumerateDates(leave.from_date, leave.to_date));
  for (const row of (data ?? []) as OverrideRow[]) {
    if (!days.has(row.business_date)) continue;
    const reason = `Leave cancelled: ${leave.id}`;
    try {
      const prior = await rowBeforeApproval(service, row);
      if (prior) {
        const restore = {
          worked_min: prior.worked_min,
          late_min: prior.late_min,
          ot_min: prior.ot_min,
          absent: prior.absent,
          note: prior.note,
          reason: prior.reason,
          store_id: prior.store_id,
          edited_by: actorId,
        };
        const { data: after, error: upErr } = await service
          .from(OVERRIDE_TABLE)
          .update(restore)
          .eq('id', row.id)
          .select(OVERRIDE_COLS)
          .single();
        if (upErr) throw new Error(upErr.message);
        await logHrAudit(service, { actorId, action: 'update', table: OVERRIDE_TABLE, recordId: row.id, before: row, after, reason });
      } else {
        const { error: delErr } = await service.from(OVERRIDE_TABLE).delete().eq('id', row.id);
        if (delErr) throw new Error(delErr.message);
        await logHrAudit(service, { actorId, action: 'delete', table: OVERRIDE_TABLE, recordId: row.id, before: row, after: null, reason });
      }
      revertedDays++;
    } catch {
      warnings.push(`Could not restore the timesheet for ${row.business_date}`);
    }
  }
  return { revertedDays, warnings };
}
