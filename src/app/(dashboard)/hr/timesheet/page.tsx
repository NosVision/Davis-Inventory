'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from '@/components/ui';
import { openBusinessDateBangkok } from '@/lib/utils/date';
import {
  DayTable,
  SummaryChips,
  addDaysStr,
  isEmptyDay,
  type DaySummary,
  type TimesheetTotals,
} from '@/components/hr/timesheet-parts';

interface StoreOpt {
  id: string;
  store_code: string;
  store_name: string;
}
interface Employee {
  user_id: string;
  name: string;
  work_hours_per_day: number;
  ot_eligible: boolean;
  days: DaySummary[];
  totals: TimesheetTotals;
}

const MAX_RANGE_DAYS = 62;

function dayDiff(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

const inputCls =
  'mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

export default function HrTimesheetPage() {
  const t = useTranslations('hr.timesheet');

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [to, setTo] = useState<string>(() => openBusinessDateBangkok());
  const [from, setFrom] = useState<string>(() => addDaysStr(openBusinessDateBangkok(), -6));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // manageable stores → default to first
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/manageable-stores');
        const json = await res.json();
        const list = (json.data ?? []) as StoreOpt[];
        setStores(list);
        setStoreId((prev) => prev || list[0]?.id || '');
      } catch {
        setStores([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!storeId) {
      setEmployees([]);
      setLoading(false);
      return;
    }
    if (from > to || dayDiff(from, to) > MAX_RANGE_DAYS) {
      toast({ type: 'warning', title: t('rangeTooLong') });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/timesheet?store_id=${storeId}&from=${from}&to=${to}`);
      if (!res.ok) throw new Error('load failed');
      const j = await res.json();
      setEmployees((j.employees ?? []) as Employee[]);
    } catch {
      toast({ type: 'error', title: t('loadFailed') });
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [storeId, from, to, t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('filterStore')}
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={inputCls}>
              {stores.length === 0 && <option value="">{t('noStores')}</option>}
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.store_name}
                </option>
              ))}
            </select>
          </label>
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
      ) : stores.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
          {t('noStores')}
        </p>
      ) : employees.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
          {t('noEmployees')}
        </p>
      ) : (
        <div className="space-y-6">
          {employees.map((emp) => {
            const hasData = emp.days.some((d) => !isEmptyDay(d));
            return (
              <section key={emp.user_id} className="space-y-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{emp.name}</h2>
                <SummaryChips totals={emp.totals} />
                {hasData ? (
                  <DayTable days={emp.days} />
                ) : (
                  <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400 dark:border-gray-700">
                    {t('noData')}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
