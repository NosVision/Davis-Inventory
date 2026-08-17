/**
 * Pay-cycle date arithmetic (§E), shared by payrun generation and the coverage panel.
 *
 * A period labelled (year, month) runs the 26th of the PREVIOUS month through the 25th of that
 * month, and is paid on its last calendar day. Extracted from the payrun POST so the coverage
 * panel cannot drift from the boundaries payroll actually generates against — the panel's whole
 * job is to say "this period is short", which is worthless if it measures a different period.
 */

import { todayBangkok } from '@/lib/utils/date';

export interface PayCycle {
  /** First day of the period, inclusive (YYYY-MM-DD). */
  start: string;
  /** Last day of the period, inclusive (YYYY-MM-DD). */
  end: string;
  /** Pay date — the last calendar day of the period month. */
  payDate: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** @param month 1–12 */
export function cycleDates(year: number, month: number): PayCycle {
  const startMonth = month === 1 ? 12 : month - 1;
  const startYear = month === 1 ? year - 1 : year;
  const start = `${startYear}-${pad(startMonth)}-26`;
  const end = `${year}-${pad(month)}-25`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // day 0 of next month
  const payDate = `${year}-${pad(month)}-${pad(lastDay)}`;
  return { start, end, payDate };
}

/**
 * Has this period finished? Payroll can be generated early — the POST route has no date guard, and
 * generating a draft mid-period is a legitimate preview — so "no payslips yet" only means something
 * is missing once the period has actually closed. Before that it means "not due yet".
 */
export function isCycleClosed(cycle: PayCycle, today: string = todayBangkok()): boolean {
  return today > cycle.end;
}
