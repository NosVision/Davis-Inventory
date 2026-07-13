import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Finalized-period lock (§Phase 0B). Timesheet inputs that feed payroll — the schedule, attendance
 * corrections, and HR timesheet overrides — must not change after the pay period they belong to has
 * been FINALIZED (and possibly paid). Reopening the payrun (which now also checks bank export) is the
 * only sanctioned path to edit history.
 *
 * A pay period is finalized-locked for a `businessDate` + store scope when a finalized payrun covers
 * it: `cycle_start <= businessDate <= cycle_end` AND the payrun's scope includes the store — either a
 * company-wide payrun (`store_id IS NULL`, covers every store) or a store-specific payrun whose
 * `store_id` is one of `storeIds`.
 *
 * `storeIds` is the set of stores the edited row/employee belongs to. An empty array means "no known
 * store" → only a company-wide finalized payrun can lock the date.
 */
export async function isDateInFinalizedPeriod(
  service: SupabaseClient,
  businessDate: string,
  storeIds: string[]
): Promise<boolean> {
  let query = service
    .from('hr_payruns')
    .select('id')
    .eq('status', 'finalized')
    .lte('cycle_start', businessDate)
    .gte('cycle_end', businessDate)
    .limit(1);

  // Scope: a company-wide (NULL) finalized payrun always locks; a store-specific one locks only when
  // its store is among the row's stores. storeIds are trusted UUIDs sourced from our own tables.
  const scoped = storeIds.filter((s) => typeof s === 'string' && s.length > 0);
  query = scoped.length
    ? query.or(`store_id.is.null,store_id.in.(${scoped.join(',')})`)
    : query.is('store_id', null);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Range variant of {@link isDateInFinalizedPeriod}: true when ANY day in the inclusive
 * [fromDate, toDate] range falls in a finalized payrun for the store scope. Used where an action
 * spans multiple days (e.g. approving a leave) — approving must be refused if it would touch even
 * one finalized day. Overlap: `cycle_start <= toDate AND cycle_end >= fromDate`.
 */
export async function isRangeInFinalizedPeriod(
  service: SupabaseClient,
  fromDate: string,
  toDate: string,
  storeIds: string[]
): Promise<boolean> {
  let query = service
    .from('hr_payruns')
    .select('id')
    .eq('status', 'finalized')
    .lte('cycle_start', toDate)
    .gte('cycle_end', fromDate)
    .limit(1);

  const scoped = storeIds.filter((s) => typeof s === 'string' && s.length > 0);
  query = scoped.length
    ? query.or(`store_id.is.null,store_id.in.(${scoped.join(',')})`)
    : query.is('store_id', null);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * The stores an employee belongs to (from user_stores), optionally unioned with an extra store id.
 * The finalized-period check must consider every store the employee's payroll could run under —
 * a company-wide payrun OR one scoped to any of their stores locks their day.
 */
export async function employeeStoreIds(
  service: SupabaseClient,
  userId: string,
  extra?: string | null
): Promise<string[]> {
  const { data } = await service.from('user_stores').select('store_id').eq('user_id', userId);
  const ids = new Set((data ?? []).map((s) => s.store_id as string));
  if (extra) ids.add(extra);
  return [...ids];
}

/** Standard 409 payload when an edit is rejected because its pay period is finalized. */
export const FINALIZED_PERIOD_ERROR =
  'This pay period is finalized — reopen the payrun before editing its schedule, punches, or overrides.';
