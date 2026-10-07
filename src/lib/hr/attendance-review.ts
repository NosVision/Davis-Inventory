/**
 * Why a punch sits in HR's attendance review queue, and the punches that should not be there.
 *
 * A punch is held for review for one of four reasons — no GPS, outside the geofence, a VPN-suspect
 * IP, or a check-in whose day never got a check-out. The last one was 80% of the queue (client
 * report 2026-10-08: "รายการตรวจสอบเยอะมากในแต่ละวัน") and it is the same fact the employee's own
 * "forgot to check out" request already puts in front of HR. So:
 *
 *   - while that request is pending, the check-in is left out of the punch queue (HR decides it
 *     once, on the request);
 *   - when the request is decided, the check-in is settled with it.
 *
 * A check-in that is ALSO suspect for another reason (no GPS, outside, VPN) is never handed off —
 * the request only answers when the person left, not where they were when they arrived.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type ReviewReason = 'no_gps' | 'outside' | 'vpn' | 'unclosed';

export interface PunchReviewFacts {
  type: string;
  gps_lat: number | null;
  in_geofence: boolean | null;
  is_vpn_suspect: boolean;
}

/** The reasons readable off the punch itself — everything except "no check-out". */
export function punchOwnReasons(p: PunchReviewFacts): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  if (p.gps_lat === null) reasons.push('no_gps');
  if (p.in_geofence === false) reasons.push('outside');
  if (p.is_vpn_suspect) reasons.push('vpn');
  return reasons;
}

/** A check-in whose only possible reason for review is the missing check-out. */
export function isOnlyUnclosedCandidate(p: PunchReviewFacts): boolean {
  return p.type === 'in' && punchOwnReasons(p).length === 0;
}

interface QueueRow extends PunchReviewFacts {
  id: string;
  user_id: string;
  business_date: string;
}

const dayKey = (userId: string, businessDate: string) => `${userId}|${businessDate}`;

/**
 * Every review reason for a page of punches. "unclosed" needs the day's other punches, so it is
 * looked up once for the whole page.
 */
export async function reviewReasonsFor(
  service: SupabaseClient,
  rows: readonly QueueRow[]
): Promise<Map<string, ReviewReason[]>> {
  const ins = rows.filter((r) => r.type === 'in');
  const closed = new Set<string>();
  if (ins.length > 0) {
    const { data, error } = await service
      .from('hr_attendance')
      .select('user_id, business_date')
      .eq('type', 'out')
      .in('user_id', [...new Set(ins.map((r) => r.user_id))])
      .in('business_date', [...new Set(ins.map((r) => r.business_date))]);
    // Thrown, not swallowed: an empty `closed` set would label every check-in "no check-out".
    if (error) throw new Error(error.message);
    for (const o of (data ?? []) as { user_id: string; business_date: string }[]) {
      closed.add(dayKey(o.user_id, o.business_date));
    }
  }
  return new Map(
    rows.map((r) => {
      const reasons = punchOwnReasons(r);
      if (r.type === 'in' && !closed.has(dayKey(r.user_id, r.business_date))) reasons.push('unclosed');
      return [r.id, reasons];
    })
  );
}

/**
 * Pending check-ins whose day already has a pending correction request and nothing else wrong
 * with them. They stay `pending` in the table — only the queue leaves them out — so a rejected
 * request puts them straight back in front of HR.
 */
export async function punchIdsAwaitingRequests(
  service: SupabaseClient,
  userIds: readonly string[] | null = null
): Promise<string[]> {
  // Only a missing check-out: it is the one kind whose approval settles the check-in
  // (settleCheckInWithRequest). Any other kind would hide the punch and then hand it back.
  let reqQuery = service
    .from('hr_attendance_requests')
    .select('user_id, business_date')
    .eq('status', 'pending')
    .eq('kind', 'missing_out');
  if (userIds) reqQuery = reqQuery.in('user_id', userIds as string[]);
  const { data: requests, error: reqErr } = await reqQuery;
  if (reqErr) throw new Error(reqErr.message);
  const filed = (requests ?? []) as { user_id: string; business_date: string }[];
  if (filed.length === 0) return [];

  const filedDays = new Set(filed.map((r) => dayKey(r.user_id, r.business_date)));
  const { data: punches, error: punchErr } = await service
    .from('hr_attendance')
    .select('id, user_id, business_date, type, gps_lat, in_geofence, is_vpn_suspect')
    .eq('review_status', 'pending')
    .eq('type', 'in')
    .in('user_id', [...new Set(filed.map((r) => r.user_id))])
    .in('business_date', [...new Set(filed.map((r) => r.business_date))]);
  if (punchErr) throw new Error(punchErr.message);

  // The ids travel in the request URL as a `not.in` list (~37 chars each). Past this cap the rest
  // simply stay in the queue — shown twice, never lost.
  return ((punches ?? []) as QueueRow[])
    .filter((p) => filedDays.has(dayKey(p.user_id, p.business_date)) && isOnlyUnclosedCandidate(p))
    .map((p) => p.id)
    .slice(0, MAX_EXCLUDED_IDS);
}

const MAX_EXCLUDED_IDS = 200;

export const AUTO_SETTLE_NOTE = 'ปิดอัตโนมัติ: ตัดสินคำขอลืมเช็คเอาท์ของวันนี้แล้ว';

/**
 * Settle the day's held check-in together with the correction request HR just decided.
 * `approved` keeps it (a check-out was recorded); `rejected` dismisses it (the day was settled as
 * absent / leave) — the same two outcomes /api/hr/attendance/[id]/review gives. Returns the ids
 * settled; a check-in that is suspect for any other reason is left pending for its own review.
 */
export async function settleCheckInWithRequest(
  service: SupabaseClient,
  opts: { userId: string; businessDate: string; outcome: 'approved' | 'rejected'; actorId: string }
): Promise<string[]> {
  const { data: held, error: heldErr } = await service
    .from('hr_attendance')
    .select('id, type, gps_lat, in_geofence, is_vpn_suspect')
    .eq('user_id', opts.userId)
    .eq('business_date', opts.businessDate)
    .eq('type', 'in')
    .eq('review_status', 'pending');
  if (heldErr) throw new Error(heldErr.message);
  const ids = ((held ?? []) as (PunchReviewFacts & { id: string })[])
    .filter(isOnlyUnclosedCandidate)
    .map((p) => p.id);
  if (ids.length === 0) return [];

  const { data: settled, error } = await service
    .from('hr_attendance')
    .update({
      review_status: opts.outcome,
      reviewed_by: opts.actorId,
      reviewed_at: new Date().toISOString(),
      review_note: AUTO_SETTLE_NOTE,
    })
    .in('id', ids)
    .eq('review_status', 'pending')
    .select('id');
  if (error) throw new Error(error.message);
  return ((settled ?? []) as { id: string }[]).map((r) => r.id);
}
