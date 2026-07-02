'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { openBusinessDateBangkok } from '@/lib/utils/date';
import {
  DayTable,
  SummaryChips,
  addDaysStr,
  isEmptyDay,
  type DaySummary,
  type TimesheetTotals,
} from '@/components/hr/timesheet-parts';

interface EssTimesheet {
  from: string;
  to: string;
  work_hours_per_day: number;
  ot_eligible: boolean;
  days: DaySummary[];
  totals: TimesheetTotals;
}

const inputCls =
  'mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

export default function MyTimesheetPage() {
  const t = useTranslations('hr.timesheet');

  const [to, setTo] = useState<string>(() => openBusinessDateBangkok());
  const [from, setFrom] = useState<string>(() => addDaysStr(openBusinessDateBangkok(), -6));
  const [data, setData] = useState<EssTimesheet | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (from > to) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/ess/timesheet?from=${from}&to=${to}`);
      if (!res.ok) throw new Error('load failed');
      setData((await res.json()) as EssTimesheet);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const hasData = data ? data.days.some((d) => !isEmptyDay(d)) : false;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('myTitle')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('mySubtitle')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('filterFrom')}
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('filterTo')}
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !data ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
          {t('noData')}
        </p>
      ) : (
        <div className="space-y-3">
          <SummaryChips totals={data.totals} />
          {hasData ? (
            <DayTable days={data.days} />
          ) : (
            <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400 dark:border-gray-700">
              {t('noData')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
