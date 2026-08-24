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

/**
 * The SV / tip / evaluation pool month that belongs on a payslip labelled (year, month) — which is
 * that SAME month.
 *
 * A pool is allocated at the START of its month and transferred to staff on the 15th of it; the
 * salary for the same month follows at month end. So August's pool, August's evaluation and
 * August's salary all land on the August slip, and the slip states one month throughout.
 *
 * It used to be the previous month (N−1), on the reading that a pool is totalled during days 1–15
 * of the NEXT month. The client settled it on 2026-08-19: there is no month-before to carry — the
 * allocation is made up front and paid inside its own month.
 *
 * Kept as a named definition rather than inlined because generation and every read path must agree.
 * When they each derived the month themselves, one drifted and a single payslip showed two
 * different SV rounds. One definition, no drift — whatever the rule happens to be.
 *
 * @param month 1–12
 * @returns 'YYYY-MM-01' — matches hr_sc_pools.period_month / hr_tip_pools.period_month
 */
export function svPeriodMonth(year: number, month: number): string {
  return `${year}-${pad(month)}-01`;
}

/**
 * The day a pool reaches staff: the 15th of the pool's own month.
 *
 * Shared by the service-charge and tip pages (the default shown before a pool is saved) and by the
 * payslip (the fallback when a draft pool has no pay_date yet). Three copies of this arithmetic is
 * how the screens came to disagree about which month a pool belonged to.
 *
 * @param periodMonth 'YYYY-MM' or any longer ISO date starting with it
 */
export function svPayDate(periodMonth: string): string {
  return `${periodMonth.slice(0, 7)}-15`;
}

/**
 * The SC pool that a PERIOD labelled `eventMonth` is docked from — the pool paid the month after.
 *
 * "Period N" here means the payroll cycle N (26th of N−1 → 25th of N), not the calendar month —
 * since 2026-08-24 every SV figure is measured on the payroll cycle, so a month label anywhere in
 * the SV chain names a cycle. Used where the source carries only a month tag rather than dates: the
 * evaluation period, and a store's stock-fine batch. For a dated event use scPoolMonthForDate.
 *
 * A pool is transferred on the 15th of its own month, so by then only the PREVIOUS cycle is closed
 * (it ended on the 25th, and payroll ran on it around the 26th–29th). Every source therefore lands
 * one month on. Pointing a deduction at its own month would aim at money already transferred.
 *
 * @param eventMonth 'YYYY-MM' or any longer ISO date starting with it
 * @returns 'YYYY-MM-01' — matches hr_sc_pools.period_month
 */
export function scPoolMonthForEvent(eventMonth: string): string {
  const [y, m] = eventMonth.slice(0, 7).split('-').map(Number);
  if (!y || !m) return `${eventMonth.slice(0, 7)}-01`;
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}

/**
 * The inverse, at month granularity: the period a pool is docked for — the one before its own.
 *
 * @param poolMonth 'YYYY-MM' or any longer ISO date starting with it
 * @returns 'YYYY-MM-01'
 */
export function scEventMonthForPool(poolMonth: string): string {
  const [y, m] = poolMonth.slice(0, 7).split('-').map(Number);
  if (!y || !m) return `${poolMonth.slice(0, 7)}-01`;
  return m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
}

/**
 * The DAYS a pool is docked for: the payroll cycle before it — 26th of M−2 → 25th of M−1.
 *
 * This is the single window every SV deduction is measured over. It used to be the previous
 * CALENDAR month, which meant one payslip carried two spans that overlapped without matching —
 * salary over 26th→25th, the SV beside it over 1st→month end — and the difference read as the
 * system contradicting itself.
 *
 * The client's own process was the payroll cycle all along: they read the deductions off last
 * month's payroll file, and that file runs 26th→25th. The 15th is only when the money moves, never
 * a period boundary (client, 2026-08-24). Aligning on it makes the whole rule one sentence: what
 * you were absent for docks that cycle's salary, and the same cycle's SV a month later.
 *
 * @param poolMonth 'YYYY-MM' or any longer ISO date starting with it
 */
export function scEventCycleForPool(poolMonth: string): PayCycle {
  const [y, m] = poolMonth.slice(0, 7).split('-').map(Number);
  return m === 1 ? cycleDates(y - 1, 12) : cycleDates(y, m - 1);
}

/**
 * The pool a dated event docks: the payroll cycle it falls in, paid out one month later.
 *
 * A warning issued on the 28th belongs to the cycle that STARTED on the 26th, so it reaches the
 * pool two transfers away — not the one 18 days later. Reading the cycle rather than the calendar
 * month is the whole difference.
 *
 * @param date 'YYYY-MM-DD' (Bangkok)
 * @returns 'YYYY-MM-01' — matches hr_sc_pools.period_month
 */
export function scPoolMonthForDate(date: string): string {
  return scPoolMonthForEvent(payMonthOf(date));
}

export function evalPeriodMonth(year: number, month: number): string {
  return month === 1 ? `${year - 1}-12-01` : `${year}-${pad(month - 1)}-01`;
}

/** One reading window on the timesheet, with the payroll consumer it feeds. */
export interface PayWindow {
  key: 'salary' | 'svCurrent' | 'svNext';
  from: string;
  to: string;
  /** 'YYYY-MM-01' of the SC pool this window docks — absent for the salary window. */
  poolMonth?: string;
  /** 'YYYY-MM-DD' the SV is transferred — absent for the salary window. */
  payDate?: string;
}

/**
 * The windows a single payroll month reads the timesheet over — the answer to "which days does
 * this number count?", which is the question HR keeps having to reconstruct by hand.
 *
 * Since everything settled onto the payroll cycle there are really only TWO spans, and one cycle
 * feeds two different payments a month apart:
 *   salary    26th of M−1 → 25th of M   this month's salary AND the SV that transfers on 15 M+1
 *   svCurrent 26th of M−2 → 25th of M−1 the SV that transferred on 15 M, printed on this slip
 *
 * svNext is therefore the SAME range as salary, kept as its own entry so a surface can name the
 * second thing that cycle pays for without recomputing it. A slip shows salary and svCurrent; they
 * sit end to end with no overlap, which is what makes the rule sayable in one line.
 *
 * @param payMonth 'YYYY-MM' or any longer ISO date starting with it — the month the slip PAYS in
 */
export function payWindows(payMonth: string): PayWindow[] {
  const monthFirst = `${payMonth.slice(0, 7)}-01`;
  const [y, m] = monthFirst.slice(0, 7).split('-').map(Number);
  const thisCycle = cycleDates(y, m);
  const prevCycle = scEventCycleForPool(monthFirst);
  const nextPool = scPoolMonthForEvent(monthFirst);
  return [
    { key: 'salary', from: thisCycle.start, to: thisCycle.end },
    {
      key: 'svCurrent',
      from: prevCycle.start,
      to: prevCycle.end,
      poolMonth: monthFirst,
      payDate: svPayDate(monthFirst),
    },
    {
      key: 'svNext',
      from: thisCycle.start,
      to: thisCycle.end,
      poolMonth: nextPool,
      payDate: svPayDate(nextPool),
    },
  ];
}

/**
 * The payroll month a date belongs to — the month whose 26th→25th cycle contains it.
 *
 * @param date 'YYYY-MM-DD'
 * @returns 'YYYY-MM'
 */
export function payMonthOf(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  // On or after the 26th the cycle has rolled into next month's pay run.
  const ms = d >= 26 ? Date.UTC(y, m, 1) : Date.UTC(y, m - 1, 1);
  return new Date(ms).toISOString().slice(0, 7);
}
