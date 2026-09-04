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
 * That holds for anyone who takes shifts. It does NOT hold for head office, and the four people it
 * failed on are the reason `hr_employees.work_store_id` now exists (migration 00200): purchasing and
 * two accountants who take no shift anywhere were attached to no venue at all, and HR — rostered
 * once at a bar — was filed under that bar. Evidence cannot answer a question the traces do not
 * contain. So the order is: an explicit assignment if HR has made one, evidence otherwise. The
 * field stays empty for the 129 people evidence already answers for, which is what keeps it from
 * rotting: nobody has to maintain what nobody had to set.
 *
 * Used by the timesheet and the roster so both agree on who belongs to a venue. They pass their OWN
 * window, which is the point: each surface answers the question for the period it is showing, not
 * for all time. Payroll deliberately no longer asks it at all — a payrun is per company, and every
 * venue axis it ever had was inferred (see api/hr/payruns/[id]/route.ts).
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
export function shiftDays(date: string, days: number): string {
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
 * `assignedStoreId` — hr_employees.work_store_id, HR's explicit "this is where they work"
 * (migration 00200) — decides alone whenever it is set. It exists because no inference could answer
 * for the four head-office staff: membership put them on five venues at once, and roster/punch
 * evidence then filed two of them under a venue they were merely rostered at and left the two who
 * never punch attached to nothing. A stated fact outranks any reading of the traces.
 *
 * With no assignment the previous rule stands, unchanged. Someone attached to a single venue always
 * belongs there, even with nothing on record — that is a new hire, and hiding them is what would
 * stop HR back-filling their first days. The evidence test only decides WHICH of several venues a
 * multi-venue person belongs to, the one case `user_stores` was ever ambiguous about.
 */
export function belongsToVenue(params: {
  storeId: string;
  /** Every venue this person is a member of (their full user_stores set). */
  memberStoreIds: readonly string[];
  /** Their entry from {@link loadWorkVenues}; undefined = no roster row and no punch anywhere. */
  workedStoreIds: ReadonlySet<string> | undefined;
  /** hr_employees.work_store_id. Set → it is the whole answer; null/undefined → infer as before. */
  assignedStoreId?: string | null;
}): boolean {
  const { storeId, memberStoreIds, workedStoreIds, assignedStoreId } = params;
  if (assignedStoreId) return assignedStoreId === storeId;
  if (memberStoreIds.length <= 1) return true;
  return workedStoreIds?.has(storeId) ?? false;
}

/**
 * profile id → hr_employees.work_store_id, for the people a venue surface is about to list.
 *
 * Loaded for the venue's whole candidate set rather than per row, and only where a value exists —
 * an employee with no assignment simply has no entry, which is what {@link belongsToVenue} reads as
 * "infer it as before".
 */
export async function loadAssignedWorkStores(
  service: SupabaseClient,
  userIds: readonly string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const { data, error } = await service
    .from('hr_employees')
    .select('profile_id, work_store_id')
    .in('profile_id', userIds as string[])
    .not('work_store_id', 'is', null);
  if (error) throw new Error(`work_store_id lookup failed: ${error.message}`);
  for (const row of (data ?? []) as { profile_id: string | null; work_store_id: string | null }[]) {
    if (row.profile_id && row.work_store_id) map.set(row.profile_id, row.work_store_id);
  }
  return map;
}

/**
 * Everyone HR has ASSIGNED to this venue, whether or not `user_stores` lists them here.
 *
 * A venue's candidate set starts from its `user_stores` members, which is a grant table nobody
 * updates for HR's sake. Without this a work_store_id pointing at a venue the person is not a
 * member of would silently do nothing — the field would look set and change no screen, which is a
 * worse failure than the one it was added to fix.
 */
export async function loadAssignedToVenue(
  service: SupabaseClient,
  storeId: string
): Promise<string[]> {
  const { data, error } = await service
    .from('hr_employees')
    .select('profile_id')
    .eq('work_store_id', storeId);
  if (error) throw new Error(`work_store_id members lookup failed: ${error.message}`);
  return ((data ?? []) as { profile_id: string | null }[])
    .map((r) => r.profile_id)
    .filter((id): id is string => !!id);
}

/**
 * Every profile id with at least one KEPT punch anywhere, over an EXACT `from`..`to` window — pure
 * attendance evidence, unlike {@link loadWorkVenues} which also counts a bare roster row as
 * "worked". A roster row is exactly what a rostered-but-never-punching employee has plenty of, so
 * the roster∪punch union can never flag them; this is the punch-only half, for exactly that case
 * (see migration 00197's comment for the incident this exists to catch). Callers intersect the
 * result against their own candidate list — this returns org-wide ids, not a per-user lookup.
 *
 * No automatic widening here, unlike the venue-attachment functions above: the never-punched
 * banner's caller (`schedule/route.ts`) computes its own bounded window via
 * {@link neverPunchedWindow} and needs that window respected exactly, not silently pushed further
 * back.
 */
export async function loadPunchedInRange(
  service: SupabaseClient,
  from: string,
  to: string
): Promise<Set<string>> {
  const { data, error } = await service.rpc('hr_punched_user_ids', { p_from: from, p_to: to });
  if (error) throw new Error(`hr_punched_user_ids failed: ${error.message}`);
  return new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
}

/**
 * The never-punched banner's evidence window (spec §4 D1,
 * `docs/superpowers/specs/2026-08-28-payroll-command-center-design.md`): anchored to TODAY, never
 * the viewed month — so opening a future or historical month never asks the question about a
 * window that hasn't happened yet or has already closed — and floored so the lookback never
 * reaches before `policyStart`, the date the "everyone must clock in" policy began counting
 * (2026-09-01). Before that date there is no valid window at all: returns null, and the caller
 * shows no banner rather than querying a window that ends before it begins.
 *
 * The floor matters because the alternative — widening blindly by `lookbackDays` off of `today` —
 * is exactly what fired the banner for ~124 of 127 people on first open: migration 00196 wiped
 * every attendance row, so a window reaching back past the policy start found almost nobody
 * punched, including everyone the policy was never asking to have punched yet.
 */
export function neverPunchedWindow(
  today: string,
  policyStart: string,
  lookbackDays: number = VENUE_ATTACHMENT_LOOKBACK_DAYS
): { from: string; to: string } | null {
  if (today < policyStart) return null;
  const rawFrom = shiftDays(today, -lookbackDays);
  return { from: rawFrom > policyStart ? rawFrom : policyStart, to: today };
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
