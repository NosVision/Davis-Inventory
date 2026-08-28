/**
 * Unauthorized-absence day counts over a period — the SAME definition the payrun POST uses to dock
 * salary (`src/app/api/hr/payruns/route.ts`'s `unauthorizedAbsentDays`): a scheduled day with no
 * in-punch, not covered by an approved leave, inside the employed window. A day past
 * `closedThrough` is never an absence (time-engine's `closedThrough` guard) — a published roster's
 * future days must not scream "absent" for shifts nobody could have worked yet.
 *
 * Built for the payroll coverage panel (Task 7 of the payroll-command-center plan — the August 2026
 * incident: ten back-office staff who never clock in were marked absent ~20 days each and a draft
 * slip silently docked two thirds of a salary, with nothing on any screen saying so until the slip
 * was opened). The panel needs to know, BEFORE a payrun is generated or finalized, which staff are
 * heading for a heavy absence hit — and that number is worthless unless it agrees with what the
 * payrun itself would compute.
 *
 * NOTE ON DUPLICATION: this reimplements a slice of the payrun POST's per-day assembly (schedule +
 * attendance + overrides + leaves → computeDaySummary → unauthorizedAbsentDays) rather than sharing
 * code with it directly — routes are not importable modules, and the payrun POST's version is
 * entangled with proration, SC/tip pools and payslip persistence in one ~700-line handler. Carving a
 * shared import out of that handler was judged too invasive to do safely in the task that added this
 * file (money-critical, already shipped and reviewed, outside that task's reviewed blast radius). The
 * pure day-count logic below (`countUnauthorizedAbsentDays`) is instead kept in its own small,
 * unit-tested function — see scripts/hr-misc-assert.cjs — so it can be pointed at BOTH callers by a
 * later refactor with confidence, and so it does not silently drift in the meantime. If this
 * function's count and the payrun POST's ever disagree, the payrun POST is ground truth: fix here to
 * match it, not the other way round.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeDaySummary, applyOverride, type TimesheetOverride } from './time-engine';

export interface ScheduleDayInfo {
  is_day_off: boolean;
  shift: { start_time: string; end_time: string } | null;
}

export interface AbsenceCountInput {
  cycleStart: string; // YYYY-MM-DD, inclusive
  cycleEnd: string; // YYYY-MM-DD, inclusive
  /** Last business date that has actually closed — see time-engine's `closedThrough`. */
  closedThrough: string | null;
  /** hr_employees.start_date / end_date — null = employed the whole cycle on that side. */
  startDate: string | null;
  endDate: string | null;
  /** work_date -> schedule cell, for dates that HAVE a roster row. */
  scheduleByDate: ReadonlyMap<string, ScheduleDayInfo>;
  /** business_dates with at least one kept (non-rejected) in-punch. */
  punchedDates: ReadonlySet<string>;
  /** business_date -> HR override, for dates that have one. */
  overrideByDate: ReadonlyMap<string, TimesheetOverride>;
  /** Approved leaves overlapping the cycle (unclipped; clipped internally). */
  leaves: readonly { from_date: string; to_date: string }[];
}

/** Inclusive YYYY-MM-DD range, UTC calendar math (mirrors the identical helper in the payrun/timesheet routes). */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  let guard = 0;
  while (cur <= end && guard < 400) {
    out.push(new Date(cur).toISOString().slice(0, 10));
    cur += 86_400_000;
    guard++;
  }
  return out;
}

/**
 * Pure: no I/O, no clock reads. Only the fields `computeDaySummary`'s `absent` flag actually depends
 * on are threaded through — `workHoursPerDay`/`otEligible` (OT-only) and punch TIMES (late-only) are
 * irrelevant here, so callers need not supply real punch timestamps, only which dates were punched.
 */
export function countUnauthorizedAbsentDays(input: AbsenceCountInput): number {
  const leaveCovered = new Set<string>();
  for (const lv of input.leaves) {
    const from = lv.from_date < input.cycleStart ? input.cycleStart : lv.from_date;
    const to = lv.to_date > input.cycleEnd ? input.cycleEnd : lv.to_date;
    for (const d of dateRange(from, to)) leaveCovered.add(d);
  }
  // Mirrors the payrun POST's inWindow clip exactly: no start/end date = employed the whole cycle.
  const empStart = input.startDate && input.startDate > input.cycleStart ? input.startDate : input.cycleStart;
  const empEnd = input.endDate && input.endDate < input.cycleEnd ? input.endDate : input.cycleEnd;

  let count = 0;
  for (const date of dateRange(input.cycleStart, input.cycleEnd)) {
    const cell = input.scheduleByDate.get(date);
    const derived = computeDaySummary({
      businessDate: date,
      shift: cell?.shift ?? null,
      isDayOff: cell?.is_day_off ?? false,
      hasSchedule: !!cell,
      punches: input.punchedDates.has(date) ? [{ type: 'in', ts: `${date}T00:00:00Z` }] : [],
      workHoursPerDay: 8, // not read by `absent`
      otEligible: false, // not read by `absent`
      closedThrough: input.closedThrough,
    });
    const merged = applyOverride(derived, input.overrideByDate.get(date));
    if (merged.absent && !leaveCovered.has(date) && date >= empStart && date <= empEnd) count++;
  }
  return count;
}

export interface AbsenceMember {
  profile_id: string;
  start_date: string | null;
  end_date: string | null;
}

/**
 * I/O wrapper: loads the cycle's schedule/attendance/overrides/leaves for `members` and reduces each
 * to a day count via {@link countUnauthorizedAbsentDays}.
 *
 * Row-cap note: schedule and attendance are read through `hr_schedule_for_members` /
 * `hr_attendance_for_members` (migration 00198) rather than a flat `.from(...).select(...)` — one
 * row per MEMBER (with that member's days folded into a JSON array), not one row per member per
 * day. A flat select over a whole slice's cycle is exactly what saturates PostgREST's silent
 * 1000-row cap (32 rostered people × 31 days = 992; production runs 131 staff) — see
 * `hr_work_venues`'s doc comment for the same concern against hr_schedule, and migration 00198's
 * comment for the incident this reintroduced it once already. Callers should still scope `members`
 * to one payroll slice (company × payroll group) rather than a whole-company roster spanning many
 * slices at once: that keeps the bound at slice headcount, which is the granularity the payrun
 * itself already reads at.
 */
export async function loadUnauthorizedAbsentDays(
  service: SupabaseClient,
  members: readonly AbsenceMember[],
  cycleStart: string,
  cycleEnd: string,
  closedThrough: string | null
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const userIds = members.map((m) => m.profile_id);
  if (userIds.length === 0) return result;

  const [scheduleRes, attendanceRes, overridesRes, leavesRes] = await Promise.all([
    // Bounded by MEMBER, not member × day — see this function's doc comment / migration 00198.
    service.rpc('hr_schedule_for_members', { p_user_ids: userIds, p_from: cycleStart, p_to: cycleEnd }),
    // Matches the payrun POST: a punch HR rejected (out-of-geofence / VPN-suspect) is not evidence
    // of attendance; NULL review_status (an ordinary un-flagged punch) is kept — enforced inside the
    // SQL function itself (00198), mirroring hr_punched_user_ids' (00197) filter exactly.
    service.rpc('hr_attendance_for_members', { p_user_ids: userIds, p_from: cycleStart, p_to: cycleEnd }),
    service
      .from('hr_timesheet_overrides')
      .select('user_id, business_date, worked_min, late_min, ot_min, absent, reason')
      .in('user_id', userIds)
      .gte('business_date', cycleStart)
      .lte('business_date', cycleEnd),
    service
      .from('hr_leaves')
      .select('user_id, from_date, to_date')
      .in('user_id', userIds)
      .eq('status', 'approved')
      .lte('from_date', cycleEnd)
      .gte('to_date', cycleStart),
  ]);
  // Any failure here — including the 00198 functions not existing yet on a database this migration
  // hasn't reached — throws rather than guessing. The only caller (the coverage route's heavy-absence
  // check) already treats a thrown error as "couldn't verify, warn about nothing" rather than a wrong
  // number on screen; see its own comment for why that degrade is safe here specifically.
  if (scheduleRes.error || attendanceRes.error || overridesRes.error || leavesRes.error) {
    throw new Error('Failed to load attendance for absence summary');
  }

  type ScheduleMemberRow = {
    user_id: string;
    cells: { work_date: string; is_day_off: boolean; start_time: string | null; end_time: string | null }[] | null;
  };
  const scheduleByUser = new Map<string, Map<string, ScheduleDayInfo>>();
  for (const row of (scheduleRes.data ?? []) as unknown as ScheduleMemberRow[]) {
    const m = new Map<string, ScheduleDayInfo>();
    for (const c of row.cells ?? []) {
      m.set(c.work_date, {
        is_day_off: c.is_day_off,
        shift: c.start_time && c.end_time ? { start_time: c.start_time, end_time: c.end_time } : null,
      });
    }
    scheduleByUser.set(row.user_id, m);
  }

  type AttendanceMemberRow = { user_id: string; punched_dates: string[] | null };
  const punchedByUser = new Map<string, Set<string>>();
  for (const row of (attendanceRes.data ?? []) as unknown as AttendanceMemberRow[]) {
    punchedByUser.set(row.user_id, new Set(row.punched_dates ?? []));
  }

  const overrideByUser = new Map<string, Map<string, TimesheetOverride>>();
  for (const o of (overridesRes.data ?? []) as {
    user_id: string;
    business_date: string;
    worked_min: number | null;
    late_min: number | null;
    ot_min: number | null;
    absent: boolean | null;
    reason: string | null;
  }[]) {
    const m = overrideByUser.get(o.user_id) ?? new Map<string, TimesheetOverride>();
    m.set(o.business_date, { worked_min: o.worked_min, late_min: o.late_min, ot_min: o.ot_min, absent: o.absent, reason: o.reason });
    overrideByUser.set(o.user_id, m);
  }

  const leavesByUser = new Map<string, { from_date: string; to_date: string }[]>();
  for (const lv of (leavesRes.data ?? []) as { user_id: string; from_date: string; to_date: string }[]) {
    const list = leavesByUser.get(lv.user_id) ?? [];
    list.push({ from_date: lv.from_date, to_date: lv.to_date });
    leavesByUser.set(lv.user_id, list);
  }

  for (const m of members) {
    const count = countUnauthorizedAbsentDays({
      cycleStart,
      cycleEnd,
      closedThrough,
      startDate: m.start_date,
      endDate: m.end_date,
      scheduleByDate: scheduleByUser.get(m.profile_id) ?? new Map(),
      punchedDates: punchedByUser.get(m.profile_id) ?? new Set(),
      overrideByDate: overrideByUser.get(m.profile_id) ?? new Map(),
      leaves: leavesByUser.get(m.profile_id) ?? [],
    });
    result.set(m.profile_id, count);
  }

  return result;
}
