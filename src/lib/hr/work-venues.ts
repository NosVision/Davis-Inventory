/**
 * "Works at this venue" vs "can see this venue" — the distinction `user_stores` cannot make.
 *
 * `user_stores` predates the HR module. It came from the liquor-deposit side of the app, where a row
 * means "this person oversees this venue's data", and it is literally just (user_id, store_id) — no
 * role, no primary flag. HR then read the same table as "this person works at this venue". Those are
 * different claims, and for anyone overseeing several venues they disagree: the HR/accounting team
 * appeared on five venues' timesheets and rosters and was counted in five venues' payroll
 * breakdowns, having never taken a shift at four of them (owner report 2026-08-17).
 *
 * Rather than add a field HR would have to maintain by hand for every hire, work is EVIDENCED: a
 * roster row or a kept punch at that venue inside the window on screen (see the `hr_work_venues`
 * SQL function, migration 00189). Evidence maintains itself — schedule someone at a venue and they
 * appear there; stop, and they fade from it — so this cannot rot the way a hand-set flag would.
 *
 * Used by the timesheet, the roster and the payrun venue breakdown so all three agree on who
 * belongs to a venue. They pass their OWN window, which is the point: each surface answers the
 * question for the period it is showing, not for all time.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** profile id → the store ids they have a roster row or kept punch at, within the window. */
export type WorkVenueMap = Map<string, Set<string>>;

export async function loadWorkVenues(
  service: SupabaseClient,
  from: string,
  to: string
): Promise<WorkVenueMap> {
  const map: WorkVenueMap = new Map();
  // DISTINCT pairs, computed in Postgres: bounded by (staff × venues), so this is one small read.
  // Scanning hr_schedule from the client instead would return 127 × 31 rows for a month and be
  // silently truncated at PostgREST's 1000-row cap — quietly turning "worked here" into "did not".
  const { data, error } = await service.rpc('hr_work_venues', { p_from: from, p_to: to });
  if (error) throw new Error(`hr_work_venues failed: ${error.message}`);
  for (const row of (data ?? []) as { user_id: string; store_id: string }[]) {
    if (!row.user_id || !row.store_id) continue;
    const set = map.get(row.user_id) ?? new Set<string>();
    set.add(row.store_id);
    map.set(row.user_id, set);
  }
  return map;
}

/**
 * Does this person belong on `storeId`'s HR surface for the window the map was built for?
 *
 * Someone attached to a single venue always does, even with nothing on record there — that is a new
 * hire, and hiding them is what would stop HR back-filling their first days. The evidence test only
 * decides WHICH of several venues a multi-venue person belongs to, which is the only case where
 * `user_stores` was ever ambiguous.
 */
export function belongsToVenue(params: {
  storeId: string;
  /** Every venue this person is a member of (their full user_stores set). */
  memberStoreIds: readonly string[];
  /** Their entry from {@link loadWorkVenues}; undefined = no roster row and no punch anywhere. */
  workedStoreIds: ReadonlySet<string> | undefined;
}): boolean {
  const { storeId, memberStoreIds, workedStoreIds } = params;
  if (memberStoreIds.length <= 1) return true;
  return workedStoreIds?.has(storeId) ?? false;
}

/** profile id → their full user_stores set, for the given people. */
export async function loadMemberVenues(
  service: SupabaseClient,
  userIds: readonly string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;
  const { data, error } = await service
    .from('user_stores')
    .select('user_id, store_id')
    .in('user_id', userIds as string[]);
  if (error) throw new Error(`user_stores failed: ${error.message}`);
  for (const row of (data ?? []) as { user_id: string; store_id: string }[]) {
    map.set(row.user_id, [...(map.get(row.user_id) ?? []), row.store_id]);
  }
  return map;
}
