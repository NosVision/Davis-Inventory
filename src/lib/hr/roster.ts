/**
 * ONE answer to "who is on this venue / this company right now" — for every HR surface that lists
 * people by where they work.
 *
 * Until 2026-09-19 each surface answered it for itself: the roster and the timesheet composed the
 * work-venues helpers (user_stores ∪ work_store_id, evidence-split, employed-window, system-account
 * exclusion) in two slightly different orders; the service-charge candidate list read raw
 * user_stores with no window and no active filter; the payroll runs on company × payroll group.
 * HR (คุณเมย์) kept asking "ระบบดึงชื่อจากอะไร" because a person could be on the roster, off the
 * timesheet and in the SC pool at once. This module is the single place that question is answered
 * for the venue/company axis; the schedule GET, the timesheet GET and /api/hr/employees?store_id=
 * all call {@link resolveRoster}, and the schedule write paths accept exactly the people it lists.
 *
 * Payroll deliberately does NOT go through here — a payrun is per company × payroll group, an axis
 * this module knows nothing about (see api/hr/payruns/[id]/route.ts).
 *
 * Scopes:
 *   • store    — user_stores members ∪ anyone HR assigned here (hr_employees.work_store_id), then
 *                split on venue evidence (see work-venues.ts). Independent of company: a company
 *                transfer never moves someone off a venue's roster, only off the old company's.
 *   • company  — every employee whose LIVE hr_employees.company_id matches (null = the 'none'
 *                bucket). Read fresh on every call, so a transfer takes effect on the next load.
 *   • no_venue — employees attached to no venue at all: no user_stores row anywhere AND no
 *                work_store_id. The timesheet's `store_id=none` bucket for office staff.
 *
 * Applied in every scope: an hr_employees record must exist (owner decision 2026-08-14 — a shift
 * that cannot be attached to a payroll name cannot be paid), profiles.is_system accounts are never
 * people (2026-08-11), and the employed-window rule (client ask 2026-07-22): a leaver stays listed
 * for any window overlapping their employment, then drops off.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  belongsToVenue,
  loadAssignedToVenue,
  loadMemberVenues,
  loadVenueAttachment,
  type WorkVenueMap,
} from './work-venues';
import { isDisabledLoginEmployee } from './login-disabled';

export type RosterScope =
  | { kind: 'store'; storeId: string }
  | { kind: 'company'; companyId: string | null }
  | { kind: 'no_venue' };

export interface RosterMember {
  profile_id: string;
  employee_id: string;
  full_name: string | null;
  display_name: string | null;
  username: string | null;
  company_id: string | null;
  company_name: string | null;
  work_store_id: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  position_id: string | null;
  position_name: string | null;
  position_sort: number | null;
  payroll_group_id: string | null;
  payroll_group_name: string | null;
  work_hours_per_day: number | null;
  standard_days_off: number | null;
  ot_eligible: boolean | null;
  pay_type: string | null;
  pay_confidential: boolean | null;
}

export interface RosterResult {
  /** The people this scope lists for the window. */
  members: RosterMember[];
  /**
   * Store scope only: members of the venue held out of the list because their evidence sits at
   * another venue (a user_stores row that means "oversees", not "works here"). Reported so the
   * page can offer them back rather than silently showing fewer people. Empty in other scopes.
   */
  inactiveHere: RosterMember[];
}

export interface ResolveRosterOptions {
  scope: RosterScope;
  /** Inclusive YYYY-MM-DD window the surface is showing. Drives the employed-window rule. */
  from: string;
  to: string;
  /** Store scope: also list the evidence-elsewhere members (they still appear in inactiveHere). */
  includeInactive?: boolean;
}

const DEPARTED_STATUSES: ReadonlySet<string> = new Set(['resigned', 'terminated']);

/**
 * The employed-window rule, shared by every scope. Someone currently employed (active/probation —
 * anything but a departed status) is always in; a leaver is in only while the window overlaps
 * their employment, i.e. their last working day is on or after the window start. Mirrors the
 * payroll leaver-window so the timesheet and the payrun agree about a just-offboarded person.
 */
export function isEmployedInWindow(
  emp: { status: string | null; end_date: string | null },
  from: string
): boolean {
  if (!emp.status || !DEPARTED_STATUSES.has(emp.status)) return true;
  return !!emp.end_date && emp.end_date >= from;
}

/** Row shape the resolver reads; also what {@link isRosterCandidate} decides on. */
export interface RosterSourceRow {
  id: string;
  profile_id: string | null;
  status: string | null;
  end_date: string | null;
  profile: {
    id: string;
    username: string | null;
    display_name: string | null;
    is_system: boolean | null;
    active?: boolean | null;
  } | null;
}

/**
 * Is this hr_employees row a person who can be listed at all, for a window starting `from`?
 * Requires a linked login (the row is keyed on it everywhere), refuses system accounts and an
 * employed record whose login was switched off (login-disabled.ts — the payrun drops them too), and
 * applies the employed-window rule.
 */
export function isRosterCandidate(row: RosterSourceRow, from: string): boolean {
  if (!row.profile_id || !row.profile) return false;
  if (row.profile.is_system) return false;
  if (isDisabledLoginEmployee(row, row.profile.active)) return false;
  return isEmployedInWindow(row, from);
}

/**
 * Store scope's evidence split, as a pure decision over already-loaded maps. Someone HR assigned
 * elsewhere (work_store_id) or whose only evidence is at another venue goes to `inactiveHere`;
 * everyone else is `listed`. Single-venue members always stay (a new hire with nothing rostered yet
 * is exactly who the roster page exists to schedule).
 */
export function splitByVenueEvidence(params: {
  storeId: string;
  candidates: readonly { profile_id: string; work_store_id: string | null }[];
  /** profile id → their full user_stores set. Missing = treat as a member of this venue only. */
  memberOf: ReadonlyMap<string, readonly string[]>;
  /** profile id → venues with roster/punch evidence in the (widened) window. */
  worked: WorkVenueMap;
}): { listed: string[]; inactiveHere: string[] } {
  const listed: string[] = [];
  const inactiveHere: string[] = [];
  for (const c of params.candidates) {
    const keep = belongsToVenue({
      storeId: params.storeId,
      memberStoreIds: params.memberOf.get(c.profile_id) ?? [params.storeId],
      workedStoreIds: params.worked.get(c.profile_id),
      assignedStoreId: c.work_store_id,
    });
    if (keep) listed.push(c.profile_id);
    else inactiveHere.push(c.profile_id);
  }
  return { listed, inactiveHere };
}

/** Display precedence shared with employee-name.ts: real name, nickname, login. */
export function rosterMemberName(m: Pick<RosterMember, 'full_name' | 'display_name' | 'username'>): string {
  return m.full_name?.trim() || m.display_name?.trim() || m.username?.trim() || '—';
}

/** Deterministic order for every consumer: Thai-collated by the name they will show. */
export function sortRosterMembers(members: readonly RosterMember[]): RosterMember[] {
  return [...members].sort((a, b) => rosterMemberName(a).localeCompare(rosterMemberName(b), 'th'));
}

/** A PostgREST to-one embed arrives as an object, but the generated types widen it to an array. */
type Embed<T> = T | T[] | null | undefined;
function one<T>(e: Embed<T>): T | null {
  if (!e) return null;
  return Array.isArray(e) ? e[0] ?? null : e;
}

interface RawRow extends RosterSourceRow {
  full_name: string | null;
  company_id: string | null;
  work_store_id: string | null;
  start_date: string | null;
  position_id: string | null;
  payroll_group_id: string | null;
  work_hours_per_day: number | null;
  standard_days_off: number | null;
  ot_eligible: boolean | null;
  pay_type: string | null;
  pay_confidential: boolean | null;
  position: Embed<{ name: string | null; sort_order: number | null }>;
  company: Embed<{ name: string | null }>;
  payroll_group: Embed<{ name: string | null }>;
}

const MEMBER_SELECT =
  'id, profile_id, full_name, company_id, work_store_id, status, start_date, end_date, position_id, ' +
  'payroll_group_id, work_hours_per_day, standard_days_off, ot_eligible, pay_type, pay_confidential, ' +
  'profile:profiles!hr_employees_profile_id_fkey(id, username, display_name, is_system, active), ' +
  'position:hr_positions(name, sort_order), company:hr_companies(name), payroll_group:hr_payroll_groups(name)';

function toMember(r: RawRow): RosterMember {
  const pos = one(r.position);
  return {
    profile_id: r.profile_id as string,
    employee_id: r.id,
    full_name: r.full_name,
    display_name: r.profile?.display_name ?? null,
    username: r.profile?.username ?? null,
    company_id: r.company_id,
    company_name: one(r.company)?.name ?? null,
    work_store_id: r.work_store_id,
    status: r.status,
    start_date: r.start_date,
    end_date: r.end_date,
    position_id: r.position_id,
    position_name: pos?.name ?? null,
    position_sort: pos?.sort_order ?? null,
    payroll_group_id: r.payroll_group_id,
    payroll_group_name: one(r.payroll_group)?.name ?? null,
    work_hours_per_day: r.work_hours_per_day,
    standard_days_off: r.standard_days_off,
    ot_eligible: r.ot_eligible,
    pay_type: r.pay_type,
    pay_confidential: r.pay_confidential,
  };
}

async function loadStoreCandidateIds(service: SupabaseClient, storeId: string): Promise<string[]> {
  // user_stores members, plus anyone HR explicitly placed here: work_store_id must be able to put
  // someone on a roster the access table has never heard of them for (migration 00200).
  const [membersRes, assignedHere] = await Promise.all([
    service.from('user_stores').select('user_id').eq('store_id', storeId),
    loadAssignedToVenue(service, storeId).catch(() => [] as string[]),
  ]);
  if (membersRes.error) throw new Error(`user_stores failed: ${membersRes.error.message}`);
  const members = ((membersRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id);
  return [...new Set([...members, ...assignedHere])];
}

async function loadRows(service: SupabaseClient, scope: RosterScope): Promise<RawRow[]> {
  let q = service.from('hr_employees').select(MEMBER_SELECT);
  if (scope.kind === 'store') {
    const ids = await loadStoreCandidateIds(service, scope.storeId);
    if (ids.length === 0) return [];
    q = q.in('profile_id', ids);
  } else if (scope.kind === 'company') {
    q = scope.companyId ? q.eq('company_id', scope.companyId) : q.is('company_id', null);
  }
  // no_venue: every record; the venue subtraction happens once the candidates are known.
  const { data, error } = await q;
  if (error) throw new Error(`roster load failed: ${error.message}`);
  return (data ?? []) as unknown as RawRow[];
}

/** Everyone attached to any venue, by either mechanism — for the no_venue subtraction. */
async function loadAnyVenueAttached(service: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await service.from('user_stores').select('user_id');
  if (error) throw new Error(`user_stores failed: ${error.message}`);
  return new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
}

/**
 * Resolve the people a venue/company surface lists for a window. Throws when the base load fails
 * (callers 500); the evidence split degrades to "list every member" on its own, because showing
 * too many is recoverable and dropping someone off a roster they are meant to be on is not
 * (owner report 2026-08-17).
 */
export async function resolveRoster(
  service: SupabaseClient,
  { scope, from, to, includeInactive = false }: ResolveRosterOptions
): Promise<RosterResult> {
  const rows = (await loadRows(service, scope)).filter((r) => isRosterCandidate(r, from));

  if (scope.kind === 'no_venue') {
    const attached = await loadAnyVenueAttached(service);
    const members = rows.filter((r) => !r.work_store_id && !attached.has(r.profile_id as string)).map(toMember);
    return { members: sortRosterMembers(members), inactiveHere: [] };
  }

  if (scope.kind === 'company') {
    return { members: sortRosterMembers(rows.map(toMember)), inactiveHere: [] };
  }

  const candidates = rows.map((r) => ({ profile_id: r.profile_id as string, work_store_id: r.work_store_id }));
  const ids = candidates.map((c) => c.profile_id);
  let split: { listed: string[]; inactiveHere: string[] } = { listed: ids, inactiveHere: [] };
  if (ids.length > 0) {
    try {
      const [worked, memberOf] = await Promise.all([
        // Attachment (90-day lookback), not this window's activity — otherwise opening a fresh
        // month is circular: the page you would schedule someone on hides them for being unscheduled.
        loadVenueAttachment(service, from, to),
        loadMemberVenues(service, ids),
      ]);
      split = splitByVenueEvidence({ storeId: scope.storeId, candidates, memberOf, worked });
    } catch {
      split = { listed: ids, inactiveHere: [] };
    }
  }
  const byId = new Map(rows.map((r) => [r.profile_id as string, toMember(r)]));
  const inactiveHere = split.inactiveHere.map((id) => byId.get(id)!);
  const listedIds = includeInactive ? ids : split.listed;
  return {
    members: sortRosterMembers(listedIds.map((id) => byId.get(id)!)),
    inactiveHere: sortRosterMembers(inactiveHere),
  };
}

/**
 * The profile ids a store's schedule may be written for over a date range: exactly what the
 * roster GET can show for that store, including the evidence-elsewhere members HR can toggle back
 * in (if the grid can show them, a save must not refuse them). One check for the single-cell and
 * batch write paths, replacing two hand-rolled "must have a user_stores row" lookups that refused
 * everyone HR had placed here via work_store_id (2026-09-19).
 */
export async function loadSchedulableProfileIds(
  service: SupabaseClient,
  storeId: string,
  from: string,
  to: string
): Promise<Set<string>> {
  const { members } = await resolveRoster(service, {
    scope: { kind: 'store', storeId },
    from,
    to,
    includeInactive: true,
  });
  return new Set(members.map((m) => m.profile_id));
}

/** First id not on the roster, or null when every id is schedulable. Pure. */
export function findNotSchedulable(rosterIds: ReadonlySet<string>, userIds: readonly string[]): string | null {
  return userIds.find((id) => !rosterIds.has(id)) ?? null;
}
