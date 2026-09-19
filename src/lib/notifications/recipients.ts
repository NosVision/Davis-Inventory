/**
 * Who, out of a venue's member list, should actually receive a venue notification.
 *
 * notifyStoreStaff used to hand a row to every user_stores member with a matching role. On
 * 2026-09-19 that meant 21–49 rows per deposit at each venue — 28 of Upper House's 49 had not
 * signed in for a month, some were deactivated accounts, some were system/printer logins — and
 * 3,652 deposits since May had become 645k notification rows (243 MB) that every client polled.
 *
 * Pure: takes the joined rows and a clock, returns the ones worth writing. Tested in
 * scripts/test-notification-recipients.cjs.
 */

export interface StoreMemberRow {
  user_id: string;
  profiles: {
    id: string;
    role: string;
    line_user_id: string | null;
    active: boolean | null;
    is_system: boolean | null;
    last_sign_in_at: string | null;
    created_at: string | null;
  };
}

export interface RecipientOptions {
  /** Date.now() at call time — injected so the rule is testable. */
  now: number;
  /** The person who caused the event; they do not need to be told. */
  excludeUserId?: string | null;
  /** Someone who has not signed in for this long is not reading notifications. */
  idleAfterDays?: number;
}

export const DEFAULT_IDLE_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function isRecentlySeen(row: StoreMemberRow, cutoff: number): boolean {
  const seen = row.profiles.last_sign_in_at ? Date.parse(row.profiles.last_sign_in_at) : NaN;
  if (Number.isFinite(seen)) return seen >= cutoff;
  // Never signed in: only a freshly created account is worth queueing for — it will find the
  // message on first login. An old account that never signed in is an abandoned one.
  const created = row.profiles.created_at ? Date.parse(row.profiles.created_at) : NaN;
  return Number.isFinite(created) && created >= cutoff;
}

export function selectStoreRecipients(rows: StoreMemberRow[], options: RecipientOptions): StoreMemberRow[] {
  const idleDays = options.idleAfterDays ?? DEFAULT_IDLE_AFTER_DAYS;
  const cutoff = options.now - idleDays * DAY_MS;
  return rows.filter(
    (row) =>
      row.user_id !== options.excludeUserId &&
      row.profiles.active !== false &&
      row.profiles.is_system !== true &&
      isRecentlySeen(row, cutoff)
  );
}
