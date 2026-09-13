/**
 * What approving a day-off swap does to the roster — the TypeScript mirror of the SQL
 * `hr_approve_dayoff_swap()` (migration 00202). Used to refuse a request at filing time with a reason
 * the employee can act on, and to show the approver what an approval will change. If this and the SQL
 * disagree, the preview lies — change both together.
 *
 * The rule (owner decision 2026-09-13):
 *   • Two different days — each person swaps THEIR OWN two days. `requester_date` is the requester's
 *     current day off and `counterpart_date` the day they want off instead, so the requester must be
 *     off on the first and rostered to work on the second. The coworker's days swap only when they
 *     mirror that (working the first, off the second): then the two really are trading days off. Any
 *     other shape leaves the coworker's roster alone — they are covering, not trading.
 *   • The same day on both sides — the two people trade that day's assignment (a shift trade).
 *
 * 00088 exchanged the requester's first day with the COUNTERPART's second day instead, which handed
 * the requester's day off to the coworker (House of Savoy, 11/09/2026).
 *
 * No imports, so scripts/hr-misc-assert.cjs can load it.
 */

export interface SwapCell {
  store_id: string | null;
  is_day_off: boolean;
}

export interface SwapCells {
  /** requester on requester_date */
  requesterFrom: SwapCell | null;
  /** requester on counterpart_date */
  requesterTo: SwapCell | null;
  /** counterpart on requester_date */
  counterpartFrom: SwapCell | null;
  /** counterpart on counterpart_date */
  counterpartTo: SwapCell | null;
}

export type SwapBlockReason =
  /** the requester has no roster row at this store on one of the days */
  | 'requester_missing'
  /** the counterpart has no roster row at this store on one of the days */
  | 'counterpart_missing'
  /** the requester is not off on the day they say they are giving up */
  | 'requester_not_off'
  /** the requester is already off on the day they want */
  | 'requester_already_off';

export type SwapPlan =
  | { ok: true; kind: 'same_day' }
  | { ok: true; kind: 'own_days'; counterpartTrades: boolean }
  | { ok: false; reason: SwapBlockReason };

export function planDayoffSwap(
  requesterDate: string,
  counterpartDate: string,
  storeId: string,
  cells: SwapCells
): SwapPlan {
  // A row at another store, or a company-scope row, is not part of this store's roster.
  const atStore = (c: SwapCell | null): SwapCell | null => (c && c.store_id === storeId ? c : null);

  if (requesterDate === counterpartDate) {
    if (!atStore(cells.requesterFrom)) return { ok: false, reason: 'requester_missing' };
    if (!atStore(cells.counterpartTo)) return { ok: false, reason: 'counterpart_missing' };
    return { ok: true, kind: 'same_day' };
  }

  const requesterFrom = atStore(cells.requesterFrom);
  const requesterTo = atStore(cells.requesterTo);
  const counterpartFrom = atStore(cells.counterpartFrom);
  const counterpartTo = atStore(cells.counterpartTo);
  if (!requesterFrom || !requesterTo) return { ok: false, reason: 'requester_missing' };
  if (!counterpartFrom || !counterpartTo) return { ok: false, reason: 'counterpart_missing' };
  if (!requesterFrom.is_day_off) return { ok: false, reason: 'requester_not_off' };
  if (requesterTo.is_day_off) return { ok: false, reason: 'requester_already_off' };
  return {
    ok: true,
    kind: 'own_days',
    counterpartTrades: !counterpartFrom.is_day_off && counterpartTo.is_day_off,
  };
}

/** Pick the four roster cells a swap touches out of rows for both people on both days. */
export function swapCellsFrom(
  rows: readonly (SwapCell & { user_id: string; work_date: string })[],
  swap: { requester_id: string; requester_date: string; counterpart_id: string; counterpart_date: string }
): SwapCells {
  const byKey = new Map(rows.map((r) => [`${r.user_id}|${r.work_date}`, r]));
  const cell = (userId: string, date: string): SwapCell | null => byKey.get(`${userId}|${date}`) ?? null;
  return {
    requesterFrom: cell(swap.requester_id, swap.requester_date),
    requesterTo: cell(swap.requester_id, swap.counterpart_date),
    counterpartFrom: cell(swap.counterpart_id, swap.requester_date),
    counterpartTo: cell(swap.counterpart_id, swap.counterpart_date),
  };
}
