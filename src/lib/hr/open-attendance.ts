/**
 * Days an employee clocked IN on and never clocked OUT of.
 *
 * Nothing used to close the loop on these: the punch simply sat there, the derived timesheet went
 * `worked_min = null` ("cannot be finalised") and the next day's check-in was accepted as if
 * nothing were wrong. One employee had four such days open, the oldest 18 days old, none of them
 * flagged for review (owner report 2026-08-07).
 *
 * The rule now: you may still clock in — losing today's time record would be worse — but the open
 * day is flagged for HR and the employee is told to file the missing check-out.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface OpenDay {
  /** The dangling `in` punch. */
  attendance_id: string;
  business_date: string;
  in_ts: string;
  store_id: string | null;
  review_status: string | null;
}

/**
 * Business dates strictly BEFORE `beforeBusinessDate` that have an `in` with no `out`.
 *
 * Today is deliberately excluded — a shift in progress is not a forgotten check-out. Bounded by
 * `lookbackDays` so this stays a cheap index lookup on (user_id, business_date) rather than a
 * full history scan on every punch.
 */
export async function findUnclosedDays(
  service: SupabaseClient,
  userId: string,
  beforeBusinessDate: string,
  lookbackDays = 60
): Promise<OpenDay[]> {
  const from = new Date(`${beforeBusinessDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - lookbackDays);
  const fromDate = from.toISOString().slice(0, 10);

  const { data } = await service
    .from('hr_attendance')
    .select('id, business_date, type, ts, store_id, review_status')
    .eq('user_id', userId)
    .gte('business_date', fromDate)
    .lt('business_date', beforeBusinessDate)
    .in('type', ['in', 'out'])
    .order('ts', { ascending: true });

  const rows = (data ?? []) as {
    id: string;
    business_date: string;
    type: string;
    ts: string;
    store_id: string | null;
    review_status: string | null;
  }[];

  const closed = new Set(rows.filter((r) => r.type === 'out').map((r) => r.business_date));
  const seen = new Set<string>();
  const open: OpenDay[] = [];
  for (const r of rows) {
    // First `in` of a day that never saw an `out`. One entry per day, not per punch.
    if (r.type !== 'in' || closed.has(r.business_date) || seen.has(r.business_date)) continue;
    seen.add(r.business_date);
    open.push({
      attendance_id: r.id,
      business_date: r.business_date,
      in_ts: r.ts,
      store_id: r.store_id,
      review_status: r.review_status,
    });
  }
  return open;
}

/**
 * Mark the dangling punches as needing HR review. Returns how many were newly flagged — already
 * flagged rows are left alone so a decision HR has made is never reopened.
 */
export async function flagUnclosedDays(
  service: SupabaseClient,
  openDays: readonly OpenDay[]
): Promise<number> {
  const toFlag = openDays.filter((d) => d.review_status === null).map((d) => d.attendance_id);
  if (toFlag.length === 0) return 0;
  const { data } = await service
    .from('hr_attendance')
    .update({ review_status: 'pending' })
    .in('id', toFlag)
    .is('review_status', null)
    .select('id');
  return (data ?? []).length;
}

/**
 * Open days the EMPLOYEE still has to act on — the ones with no correction request in flight.
 *
 * A day already filed for is waiting on HR, not on them: it must not keep nagging, and it must not
 * keep them from clocking in tomorrow. Everything else is unresolved, and since 2026-08-25 an
 * unresolved day blocks the next check-in outright (client decision): the employee closes it with a
 * reason first, which is the only moment they reliably notice they forgot.
 */
export async function findBlockingOpenDays(
  service: SupabaseClient,
  userId: string,
  beforeBusinessDate: string
): Promise<OpenDay[]> {
  const open = await findUnclosedDays(service, userId, beforeBusinessDate);
  if (open.length === 0) return [];

  const { data } = await service
    .from('hr_attendance_requests')
    .select('business_date')
    .eq('user_id', userId)
    .in('business_date', open.map((d) => d.business_date))
    .in('status', ['pending', 'approved']);
  const filed = new Set((data ?? []).map((r) => (r as { business_date: string }).business_date));
  return open.filter((d) => !filed.has(d.business_date));
}
