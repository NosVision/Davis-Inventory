// Pure helpers for the stock-penalty engine (owner ask 2026-07-09).
// Spec: docs/hr/stock-penalty-to-hr.md. Two independent clocks:
//   • Money  — weekly (Mon–Sun) escalation of the A-02 fine: 1st occ = free, 2nd = 300, 3rd = 500.
//   • SOP    — monthly (calendar) count of EVERY violation (all codes except EXP-01), money or not;
//              at the threshold (default 7) the store's head_bar gets a warning.
// These functions are side-effect free so they can be unit-tested and reused on client + server.

export const DEFAULT_FINE_TIERS = [0, 300, 500]; // baht — per weekly occurrence 1 / 2 / 3 (A-02)
export const DEFAULT_WARNING_THRESHOLD = 7;

// Codes that deduct money IMMEDIATELY at full rate (no weekly free-first): ghost count & missing.
export const IMMEDIATE_MONEY_CODES = ['A-03', 'M-01'];
// Codes that run through the weekly escalating fine (free → 300 → 500).
export const ESCALATING_CODES = ['A-02'];
// Code that is a standalone fine and never counts toward the SOP total.
export const SOP_EXEMPT_CODES = ['EXP-01'];

/**
 * ISO-8601 week key, Monday-start ("YYYY-Www"), from a Bangkok business date "YYYY-MM-DD".
 * Matches the owner's "จ–อา" week and resets every Monday.
 */
export function weekKeyMonday(businessDate: string): string {
  const [y, m, d] = businessDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Shift to the Thursday of the current ISO week, then count weeks from that year's first Thursday.
  const dayMon0 = (dt.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  dt.setUTCDate(dt.getUTCDate() - dayMon0 + 3);
  const isoYear = dt.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayMon0 = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayMon0 + 3);
  const week = 1 + Math.round((dt.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Calendar month key "YYYY-MM" (matches penalties.month_year). */
export function monthKey(businessDate: string): string {
  return businessDate.slice(0, 7);
}

/**
 * Baht fine for the Nth money-eligible occurrence of the week (1-based), given the tier table.
 * seq 1 → tiers[0] (0), seq 2 → tiers[1] (300), seq 3 → tiers[2] (500); beyond → last tier.
 */
export function fineForWeekSeq(seq: number, tiers: number[] = DEFAULT_FINE_TIERS): number {
  if (seq < 1 || tiers.length === 0) return 0;
  return tiers[Math.min(seq, tiers.length) - 1] ?? 0;
}

/** Does this penalty code count toward the monthly SOP total? Everything except EXP-01. */
export function countsTowardSop(code: string): boolean {
  return !SOP_EXEMPT_CODES.includes(code);
}
