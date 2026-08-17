'use client';

import { useMemo } from 'react';
import { Store, AlertTriangle } from 'lucide-react';
import { formatBaht } from '@/lib/pos/money';

/**
 * The register, read venue by venue.
 *
 * A payrun is generated per company; the timesheet and the roster are keyed on venue. HR could
 * therefore never tie a run back to the place the work happened without exporting and sorting by
 * hand (owner ask 2026-08-17). This is that view, and nothing else: it re-groups slips that are
 * already on screen, computes no pay, and offers no action.
 *
 * Multi-venue staff are the reason this needs care. Someone who works two venues has ONE payslip
 * but belongs to both, so they are listed under each — which makes the venue subtotals add up to
 * more than the run. Rather than silently pick a venue for them, the panel shows the subtotals,
 * shows the true run total separately, and names the double-counted people.
 */

export interface StoreRef {
  code: string;
  name: string;
}

export interface PayrunByStoreSlip {
  user_id: string;
  name: string;
  gross_satang: number;
  net_satang: number;
  stores?: StoreRef[];
}

/** Bucket key for staff with no venue at all (office: HR, accounting, graphic). */
const NO_STORE = '__none__';

interface Bucket {
  key: string;
  label: string;
  slips: PayrunByStoreSlip[];
  gross: number;
  net: number;
}

export function PayrunByStore({
  payslips,
  totals,
  isTh,
}: {
  payslips: PayrunByStoreSlip[];
  /** The run's real totals — NOT the sum of the venue rows when anyone works two venues. */
  totals: { gross: number; net: number };
  isTh: boolean;
}) {
  const tt = (th: string, en: string) => (isTh ? th : en);

  const { buckets, shared } = useMemo(() => {
    const map = new Map<string, Bucket>();
    const add = (key: string, label: string, s: PayrunByStoreSlip) => {
      const b = map.get(key) ?? { key, label, slips: [], gross: 0, net: 0 };
      b.slips.push(s);
      b.gross += s.gross_satang;
      b.net += s.net_satang;
      map.set(key, b);
    };
    for (const s of payslips) {
      const stores = s.stores ?? [];
      if (stores.length === 0) add(NO_STORE, tt('ไม่สังกัดสาขา', 'No venue'), s);
      else for (const st of stores) add(st.code, st.name || st.code, s);
    }
    const ordered = [...map.values()].sort((a, b) => {
      // The no-venue bucket is not a place — keep it last regardless of its label.
      if (a.key === NO_STORE) return 1;
      if (b.key === NO_STORE) return -1;
      return a.label.localeCompare(b.label, 'th');
    });
    return {
      buckets: ordered,
      shared: payslips.filter((s) => (s.stores?.length ?? 0) > 1),
    };
  }, [payslips, isTh]); // eslint-disable-line react-hooks/exhaustive-deps

  if (payslips.length === 0) return null;

  const headcountSum = buckets.reduce((n, b) => n + b.slips.length, 0);

  return (
    <div className="space-y-3">
      {/* Subtotals only add up to the run when nobody is shared — say which it is, every time. */}
      {shared.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/15 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-semibold">
              {tt(
                `${shared.length} คนทำงานมากกว่า 1 สาขา จึงถูกนับซ้ำในตารางนี้`,
                `${shared.length} staff work more than one venue and are counted in each row`
              )}
            </span>{' '}
            — {tt('ยอดรวมรายสาขาจึงมากกว่ายอดจริงของงวด ให้ยึดแถว', 'so the venue rows exceed the run — take the')}{' '}
            <span className="font-semibold">{tt('รวมทั้งใบ', 'run total')}</span>{' '}
            {tt('เป็นยอดจริง', 'as the real figure')}
            <br />
            <span className="opacity-80">{shared.map((s) => s.name).join(' · ')}</span>
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full min-w-[32rem] text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2">{tt('สาขา', 'Venue')}</th>
              <th className="px-3 py-2 text-right">{tt('จำนวนคน', 'Headcount')}</th>
              <th className="px-3 py-2 text-right">{tt('ยอดรวม', 'Gross')}</th>
              <th className="px-3 py-2 text-right">{tt('ยอดสุทธิ', 'Net')}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key} className="border-t border-gray-100 dark:border-gray-700/50">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-200">
                    <Store className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    {b.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{b.slips.length}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{formatBaht(b.gross)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-900 dark:text-gray-100">{formatBaht(b.net)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50">
              <td className="px-3 py-2 font-semibold text-gray-800 dark:text-gray-200">
                {tt('รวมทั้งใบ (ไม่นับซ้ำ)', 'Run total (no double count)')}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-800 dark:text-gray-200">
                {payslips.length}
                {headcountSum !== payslips.length && (
                  <span className="ml-1 font-normal text-gray-400">({tt('รายสาขารวม', 'rows')} {headcountSum})</span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-800 dark:text-gray-200">{formatBaht(totals.gross)}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">{formatBaht(totals.net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Who is in each venue — the point of the view is chasing a person to a place. */}
      <div className="grid gap-2 sm:grid-cols-2">
        {buckets.map((b) => (
          <div key={b.key} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <p className="mb-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
              {b.label} · {b.slips.length}
            </p>
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {b.slips
                .map((s) => s.name)
                .sort((x, y) => x.localeCompare(y, 'th'))
                .join(' · ')}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
