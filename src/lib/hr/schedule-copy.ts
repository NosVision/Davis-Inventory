/**
 * "Use the same as last month" for rosters that repeat — the office is the case that asked for it
 * (owner ask 2026-08-28): the same people, the same days, every month.
 *
 * Copies by WEEKDAY, never date-for-date. The 1st of one month is a Tuesday and of the next a
 * Friday; copying by date would slide everyone's day off across the week.
 *
 * Pure and import-free so scripts/hr-misc-assert.cjs can load it without a database.
 */

export interface CopySourceRow {
  user_id: string;
  work_date: string; // YYYY-MM-DD
  shift_template_id: string | null;
  is_day_off: boolean;
}

export interface CopyTargetCell {
  user_id: string;
  work_date: string;
  shift_template_id: string | null;
  is_day_off: boolean;
}

/** Every YYYY-MM-DD in a YYYY-MM, in order. */
export function monthDates(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) out.push(`${month}-${String(d).padStart(2, '0')}`);
  return out;
}

/** 0 = Sunday … 6 = Saturday, by UTC because these are calendar dates, not instants. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** What a cell holds, as a comparable key — two cells "agree" when this matches. */
function patternKey(row: CopySourceRow): string {
  return row.is_day_off ? 'off' : `shift:${row.shift_template_id ?? ''}`;
}

export function buildCopyPlan(
  source: readonly CopySourceRow[],
  toMonth: string,
  skipUserIds: ReadonlySet<string>
): CopyTargetCell[] {
  // user → weekday → pattern key → { count, latestDate, row }
  const byUser = new Map<string, Map<number, Map<string, { count: number; latest: string; row: CopySourceRow }>>>();
  for (const row of source) {
    if (skipUserIds.has(row.user_id)) continue;
    const days = byUser.get(row.user_id) ?? new Map();
    byUser.set(row.user_id, days);
    const wd = weekdayOf(row.work_date);
    const pats = days.get(wd) ?? new Map();
    days.set(wd, pats);
    const key = patternKey(row);
    const prev = pats.get(key);
    pats.set(key, {
      count: (prev?.count ?? 0) + 1,
      latest: prev && prev.latest > row.work_date ? prev.latest : row.work_date,
      row: prev && prev.latest > row.work_date ? prev.row : row,
    });
  }

  const dates = monthDates(toMonth);
  const out: CopyTargetCell[] = [];
  for (const [userId, days] of byUser) {
    for (const date of dates) {
      const pats = days.get(weekdayOf(date));
      if (!pats || pats.size === 0) continue; // that weekday never appeared in the source
      // Most frequent wins; a tie goes to whichever pattern was set later.
      let best: { count: number; latest: string; row: CopySourceRow } | null = null;
      for (const cand of pats.values()) {
        if (!best || cand.count > best.count || (cand.count === best.count && cand.latest > best.latest)) {
          best = cand;
        }
      }
      if (!best) continue;
      out.push({
        user_id: userId,
        work_date: date,
        shift_template_id: best.row.is_day_off ? null : best.row.shift_template_id,
        is_day_off: best.row.is_day_off,
      });
    }
  }
  return out;
}
