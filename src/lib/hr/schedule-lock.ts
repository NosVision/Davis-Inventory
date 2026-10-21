import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * HR roster lock (HR ask 2026-10-21). HR locks a store's month once its supervisors have finished
 * the roster; from then on store managers / captains cannot change it until HR unlocks.
 *
 * Who still writes while locked (owner decisions 2026-10-21):
 *  - company-wide HR (`auth.fullHr`) — HR fixes things without unlocking first;
 *  - an approved day-off swap — the dayoff-swaps routes write hr_schedule directly and never
 *    consult this lock.
 *
 * A lock is a row in `hr_schedule_locks` keyed (store_id, month = YYYY-MM-01).
 */

const PAGE = 1000; // PostgREST's per-request row cap

export const SCHEDULE_LOCKED_ERROR = 'ตารางกะเดือนนี้ถูก HR ล็อกไว้ — ติดต่อ HR เพื่อปลดล็อกก่อนแก้ไข';

/** 'YYYY-MM-DD' or 'YYYY-MM' → the lock row's month key 'YYYY-MM-01'. */
export function lockMonthKey(dateOrMonth: string): string {
  return `${dateOrMonth.slice(0, 7)}-01`;
}

/**
 * The (store, month) pairs that are locked, as a set of `${storeId}|${YYYY-MM-01}`. Callers pass
 * every store a write could touch — hr_schedule is unique on (user_id, work_date) across stores, so
 * an upsert here can overwrite another store's row for the same person and day.
 */
export async function loadScheduleLocks(
  service: SupabaseClient,
  storeIds: string[],
  dates: string[]
): Promise<Set<string>> {
  const stores = [...new Set(storeIds.filter(Boolean))];
  const months = [...new Set(dates.map(lockMonthKey))];
  if (!stores.length || !months.length) return new Set();
  const { data, error } = await service
    .from('hr_schedule_locks')
    .select('store_id, month')
    .in('store_id', stores)
    .in('month', months);
  if (error) throw error;
  return new Set((data ?? []).map((r) => `${r.store_id as string}|${lockMonthKey(r.month as string)}`));
}

export function isLocked(locks: Set<string>, storeId: string | null | undefined, date: string): boolean {
  return !!storeId && locks.has(`${storeId}|${lockMonthKey(date)}`);
}

/**
 * The stores whose existing rows a write to these (user, date) cells would replace — so a manager
 * of store B cannot overwrite a person's day that HR locked on store A's roster.
 */
export async function existingRowStores(
  service: SupabaseClient,
  cells: { user_id: string; work_date: string }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!cells.length) return out;
  const userIds = [...new Set(cells.map((c) => c.user_id))];
  const dates = cells.map((c) => c.work_date);
  const min = dates.reduce((a, b) => (a < b ? a : b));
  const max = dates.reduce((a, b) => (a > b ? a : b));
  // Paged: a whole venue's month is ~2,000 rows and PostgREST silently caps a select at 1,000.
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await service
      .from('hr_schedule')
      .select('id, user_id, work_date, store_id')
      .in('user_id', userIds)
      .gte('work_date', min)
      .lte('work_date', max)
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      if (r.store_id) out.set(`${r.user_id as string}|${r.work_date as string}`, r.store_id as string);
    }
    if (!data || data.length < PAGE) return out;
  }
}

/**
 * True when any of the cells falls in a locked month — of the store being written, or of the store
 * that currently owns that person's day.
 */
export async function anyCellLocked(
  service: SupabaseClient,
  storeId: string,
  cells: { user_id: string; work_date: string }[]
): Promise<boolean> {
  if (!cells.length) return false;
  const owners = await existingRowStores(service, cells);
  const locks = await loadScheduleLocks(
    service,
    [storeId, ...owners.values()],
    cells.map((c) => c.work_date)
  );
  if (!locks.size) return false;
  return cells.some(
    (c) =>
      isLocked(locks, storeId, c.work_date) ||
      isLocked(locks, owners.get(`${c.user_id}|${c.work_date}`), c.work_date)
  );
}
