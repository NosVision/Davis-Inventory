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
 * The SC pool that an event in `eventMonth` is docked from — the pool paid the month AFTER it.
 *
 * A pool is allocated at the start of its month and transferred on the 15th of it, so by then only
 * the PREVIOUS month is complete. Every source of deduction therefore lands one month on: leave and
 * absence from month M, warnings issued in M, and the evaluation for M (closed around the 10th of
 * M+1) all dock the pool paid on 15 M+1. Client confirmed 2026-08-22.
 *
 * Pointing a deduction at its own month — the arrangement inherited from when a pool paid on the
 * 15th of the FOLLOWING month — now aims at money already transferred: an absence on 20 August
 * cannot be taken out of a payment made on 15 August.
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
 * The inverse: the month whose events a pool is docked for — the month before the pool's own.
 *
 * @param poolMonth 'YYYY-MM' or any longer ISO date starting with it
 * @returns 'YYYY-MM-01'
 */
export function scEventMonthForPool(poolMonth: string): string {
  const [y, m] = poolMonth.slice(0, 7).split('-').map(Number);
  if (!y || !m) return `${poolMonth.slice(0, 7)}-01`;
  return m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
}

export function evalPeriodMonth(year: number, month: number): string {
  return month === 1 ? `${year - 1}-12-01` : `${year}-${pad(month - 1)}-01`;
}

/** The whole calendar month containing `monthFirst`, as an inclusive ISO date range. */
function calendarMonth(monthFirst: string): { from: string; to: string } {
  const [y, m] = monthFirst.slice(0, 7).split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last of this
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
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
 * A slip for month M carries figures measured over two DIFFERENT spans that merely overlap:
 *   salary    26th of M−1 → 25th of M   (the pay cycle; drives absence/leave/late deductions)
 *   svCurrent all of M−1                (the pool transferred on 15 M, printed on the same slip)
 * and a third the slip has not reached yet:
 *   svNext    all of M                  (the pool that will transfer on 15 of M+1)
 *
 * So days 1–25 of M−1 dock SV but not this slip's salary, and days 1–25 of M dock this slip's
 * salary but their SV lands a month later. One absence, two different totals, both correct — the
 * reason a slip could read "ขาดงาน 16 วัน" beside an SV panel saying 11 (client 2026-08-20).
 *
 * @param payMonth 'YYYY-MM' or any longer ISO date starting with it — the month the slip PAYS in
 */
export function payWindows(payMonth: string): PayWindow[] {
  const monthFirst = `${payMonth.slice(0, 7)}-01`;
  const [y, m] = monthFirst.slice(0, 7).split('-').map(Number);
  const prevFirst = scEventMonthForPool(monthFirst);
  const prev = calendarMonth(prevFirst);
  const cur = calendarMonth(monthFirst);
  return [
    // The cycle END is the 25th of the pay month; its start is the 26th of the month before, which
    // is the last day of prev's calendar month minus five — always the 26th, never a clamped date.
    { key: 'salary', from: `${prevFirst.slice(0, 7)}-26`, to: `${y}-${pad(m)}-25` },
    { key: 'svCurrent', from: prev.from, to: prev.to, poolMonth: monthFirst, payDate: svPayDate(monthFirst) },
    {
      key: 'svNext',
      from: cur.from,
      to: cur.to,
      poolMonth: scPoolMonthForEvent(monthFirst),
      payDate: svPayDate(scPoolMonthForEvent(monthFirst)),
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
