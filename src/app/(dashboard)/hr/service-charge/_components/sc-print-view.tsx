'use client';

import { useTranslations } from 'next-intl';
import { formatBaht } from '@/lib/pos/money';
import type { ScData, ScRow } from './types';

interface ScPrintViewProps {
  data: ScData;
  rows: ScRow[];
  storeName: string;
  periodMonth: string; // YYYY-MM
}

/**
 * Print-only summary (allocation + deductions + net) rendered inside `hidden print:block`.
 * Uses black text and a plain table so it prints cleanly regardless of theme.
 */
export function ScPrintView({ data, rows, storeName, periodMonth }: ScPrintViewProps) {
  const t = useTranslations('hr.serviceCharge');

  return (
    <div id="sc-print-area" className="text-black">
      <h1 className="text-lg font-bold">{t('printTitle')}</h1>
      <p className="mt-1 text-sm">
        {storeName} · {periodMonth}
      </p>
      <p className="mt-0.5 text-sm">
        {t('poolTotalLabel')}: {formatBaht(data.pool.total_satang)} ฿
        {data.pool.pay_date ? ` · ${t('payDateLabel')}: ${data.pool.pay_date}` : ''}
      </p>

      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1 pr-2">{t('colEmployee')}</th>
            <th className="py-1 px-2 text-right">{t('colAllocated')}</th>
            <th className="py-1 px-2 text-right">{t('colDeductions')}</th>
            <th className="py-1 pl-2 text-right">{t('colNet')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const a = r.allocation;
            const allocated = a?.allocated_satang ?? 0;
            const deducted = a
              ? a.deductions.reduce((s, d) => s + Math.max(0, d.amount_satang), 0)
              : 0;
            const net = a?.net_satang ?? allocated;
            return (
              <tr key={r.userId} className="border-b border-gray-300 align-top">
                <td className="py-1 pr-2">
                  {r.name}
                  {a && a.deductions.length > 0 && (
                    <ul className="mt-0.5 text-xs text-gray-700">
                      {a.deductions.map((d) => (
                        <li key={d.id}>
                          {d.label}: −{formatBaht(d.amount_satang)} ฿
                          {d.carry_satang > 0
                            ? ` (${t('carryLabel')} ${formatBaht(d.carry_satang)} ฿)`
                            : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="py-1 px-2 text-right">{formatBaht(allocated)}</td>
                <td className="py-1 px-2 text-right">
                  {deducted > 0 ? `−${formatBaht(deducted)}` : '—'}
                </td>
                <td className="py-1 pl-2 text-right font-semibold">{formatBaht(net)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-semibold">
            <td className="py-1 pr-2">{t('totalsLabel')}</td>
            <td className="py-1 px-2 text-right">{formatBaht(data.totals.allocated)}</td>
            <td className="py-1 px-2 text-right">−{formatBaht(data.totals.deducted)}</td>
            <td className="py-1 pl-2 text-right">{formatBaht(data.totals.net)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
