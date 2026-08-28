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

/**
 * How far back the LISTING question looks, beyond the window on screen.
 *
 * There are two different questions here and the first version of this conflated them, to the point
 * of hiding someone who plainly belonged (owner report 2026-08-17):
 *
 *   • "whose pay came from this venue in this cycle" — a fact about the cycle. Exact window.
 *   • "which venue does this person work at" — a fact about the person, which changes once or twice
 *     a year. Measuring it inside the month on screen made it behave like the first: an accountant
 *     rostered at venue 24 every month vanished from venue 24 the moment a fresh month opened with
 *     nothing in it yet. On the ROSTER that is circular — the page you would use to schedule her is
 *     the page that hid her for not being scheduled.
 *
 * So listing looks back three months. Someone who works a venue regularly stays attached to it
 * through an empty month; someone who left it more than a quarter ago falls away on their own.
 */
export const VENUE_ATTACHMENT_LOOKBACK_DAYS = 90;

/** YYYY-MM-DD shifted by whole days, in UTC (these are calendar dates, never instants). */
function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

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
 * Venue ATTACHMENT — for deciding who a venue's timesheet and roster should LIST. Widens the window
 * back by {@link VENUE_ATTACHMENT_LOOKBACK_DAYS} so an empty month cannot detach someone from the
 * venue they work every month. Payroll's venue breakdown deliberately does NOT use this: attributing
 * a cycle's money needs that cycle's evidence, not last quarter's.
 */
export async function loadVenueAttachment(
  service: SupabaseClient,
  from: string,
  to: string
): Promise<WorkVenueMap> {
  return loadWorkVenues(service, shiftDays(from, -VENUE_ATTACHMENT_LOOKBACK_DAYS), to);
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

/**
 * Every profile id with at least one KEPT punch anywhere, over `from`..`to` widened by
 * {@link VENUE_ATTACHMENT_LOOKBACK_DAYS} (same window as {@link loadVenueAttachment}) — pure
 * attendance evidence, unlike {@link loadWorkVenues} which also counts a bare roster row as
 * "worked". A roster row is exactly what a rostered-but-never-punching employee has plenty of, so
 * the roster∪punch union can never flag them; this is the punch-only half, for exactly that case
 * (see migration 00197's comment for the incident this exists to catch). Callers intersect the
 * result against their own candidate list — this returns org-wide ids, not a per-user lookup.
 */
export async function loadPunchedSince(
  service: SupabaseClient,
  from: string,
  to: string
): Promise<Set<string>> {
  const { data, error } = await service.rpc('hr_punched_user_ids', {
    p_from: shiftDays(from, -VENUE_ATTACHMENT_LOOKBACK_DAYS),
    p_to: to,
  });
  if (error) throw new Error(`hr_punched_user_ids failed: ${error.message}`);
  return new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
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
