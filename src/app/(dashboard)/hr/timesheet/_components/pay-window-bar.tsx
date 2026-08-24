'use client';

import { useLocale } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { payWindows, type PayWindow } from '@/lib/hr/pay-cycle';

/**
 * The three windows one payroll month reads the timesheet over, as pickable chips.
 *
 * HR kept asking which days a given number counted, because a slip measures its figures over spans
 * that overlap without matching: salary over 26th→25th, the SV printed beside it over the whole
 * previous calendar month. No screen put the two next to each other, so the difference read as the
 * system disagreeing with itself (client 2026-08-22).
 *
 * Letting HR SWITCH between the windows and watch the same grid change teaches the rule in a way no
 * paragraph does — which is why this is a range picker and not a help text.
 */

/** 'YYYY-MM-DD' → 'DD/MM'. Year is carried by the month stepper, so chips stay short. */
function dm(date: string): string {
  const [, m, d] = date.slice(0, 10).split('-');
  return m && d ? `${d}/${m}` : date;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' — the convention the payroll register and the slip use. */
function dmy(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : date;
}

/** 'YYYY-MM' → 'MM/YYYY'. */
export function monthLabel(month: string): string {
  const [y, m] = month.slice(0, 7).split('-');
  return y && m ? `${m}/${y}` : month;
}

/** Shift a 'YYYY-MM' anchor by whole months. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** What each window feeds, said in the words HR uses for it. */
export function windowTitle(w: PayWindow, payMonth: string, isTh: boolean): string {
  if (w.key === 'salary') {
    return isTh ? `เงินเดือน งวด ${monthLabel(payMonth)}` : `Salary · ${monthLabel(payMonth)}`;
  }
  return isTh ? `SV โอน ${dmy(w.payDate!)}` : `SV paid ${dmy(w.payDate!)}`;
}

/** One line saying what a window's numbers are actually spent on. */
export function windowPurpose(w: PayWindow, payMonth: string, isTh: boolean): string {
  if (w.key === 'salary') {
    return isTh
      ? `ขาด/ลา/สาย ในช่วงนี้ หักจากเงินเดือนที่จ่ายสิ้นเดือน ${monthLabel(payMonth)}`
      : `Absence, leave and lateness here dock the salary paid at the end of ${monthLabel(payMonth)}`;
  }
  if (w.key === 'svCurrent') {
    return isTh
      ? `ขาด/ลา/ใบเตือน ในช่วงนี้ หัก SV ที่โอน ${dmy(w.payDate!)} — ก้อนที่พิมพ์อยู่บนสลิปเดือน ${monthLabel(payMonth)}`
      : `Absence, leave and warnings here dock the SV transferred on ${dmy(w.payDate!)} — the pool printed on the ${monthLabel(payMonth)} slip`;
  }
  return isTh
    ? `ขาด/ลา/ใบเตือน ในช่วงนี้ หัก SV ที่จะโอน ${dmy(w.payDate!)} — ยังไม่อยู่บนสลิปเดือน ${monthLabel(payMonth)}`
    : `Absence, leave and warnings here dock the SV that transfers on ${dmy(w.payDate!)} — not on the ${monthLabel(payMonth)} slip yet`;
}

export function isSameWindow(w: PayWindow, from: string, to: string): boolean {
  return w.from === from && w.to === to;
}

export function PayWindowBar({
  payMonth,
  from,
  to,
  onPick,
  onShiftMonth,
}: {
  /** 'YYYY-MM' — the payroll month the three windows are derived from. */
  payMonth: string;
  from: string;
  to: string;
  onPick: (w: PayWindow) => void;
  onShiftMonth: (by: number) => void;
}) {
  const isTh = useLocale() === 'th';
  const windows = payWindows(payMonth);
  const custom = !windows.some((w) => isSameWindow(w, from, to));

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 px-3 py-2.5 dark:border-indigo-900/50 dark:bg-indigo-900/10">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-indigo-800 dark:text-indigo-300">
          {isTh ? 'ช่วงที่ดู' : 'Reading window'}
        </span>
        <span className="inline-flex items-center gap-0.5 rounded-lg border border-indigo-200 bg-white dark:border-indigo-800 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => onShiftMonth(-1)}
            aria-label={isTh ? 'งวดก่อนหน้า' : 'Previous payroll month'}
            className="rounded-l-lg px-1 py-0.5 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="px-1 text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-200">
            {monthLabel(payMonth)}
          </span>
          <button
            type="button"
            onClick={() => onShiftMonth(1)}
            aria-label={isTh ? 'งวดถัดไป' : 'Next payroll month'}
            className="rounded-r-lg px-1 py-0.5 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </span>
        <span className="text-[11px] text-indigo-700/70 dark:text-indigo-400/70">
          {isTh
            ? 'ตัวเลขบนสลิปใบเดียวกันนับคนละช่วง — กดเพื่อดูช่วงที่ตัวเลขนั้นใช้'
            : 'One slip measures its figures over different spans — pick the one a number came from'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {windows.map((w) => {
          const active = isSameWindow(w, from, to);
          return (
            <button
              key={w.key}
              type="button"
              onClick={() => onPick(w)}
              aria-pressed={active}
              title={windowPurpose(w, payMonth, isTh)}
              className={cn(
                'flex flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-colors',
                active
                  ? 'border-indigo-400 bg-white shadow-sm ring-1 ring-indigo-300 dark:border-indigo-600 dark:bg-gray-800 dark:ring-indigo-800'
                  : 'border-indigo-200/70 bg-white/60 hover:border-indigo-300 hover:bg-white dark:border-gray-700 dark:bg-gray-800/50 dark:hover:border-indigo-700'
              )}
            >
              <span
                className={cn(
                  'text-xs font-semibold',
                  active ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300'
                )}
              >
                {windowTitle(w, payMonth, isTh)}
              </span>
              <span className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                {dm(w.from)} – {dm(w.to)}
              </span>
            </button>
          );
        })}
        {/* A hand-typed range is legitimate — say it is not one of the three rather than leaving
            every chip unlit with no explanation. */}
        {custom && (
          <span className="self-center text-[11px] text-gray-500 dark:text-gray-400">
            {isTh
              ? `กำลังดูช่วงที่กำหนดเอง ${dm(from)} – ${dm(to)}`
              : `Viewing a custom range, ${dm(from)} – ${dm(to)}`}
          </span>
        )}
      </div>
    </div>
  );
}
