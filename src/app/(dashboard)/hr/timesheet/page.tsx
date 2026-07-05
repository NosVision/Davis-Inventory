'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { PageHeader, SectionHeading, toast } from '@/components/ui';
import { openBusinessDateBangkok } from '@/lib/utils/date';
import {
  DayTable,
  SummaryChips,
  addDaysStr,
  isEmptyDay,
  type DaySummary,
  type TimesheetTotals,
} from '@/components/hr/timesheet-parts';
import { TimesheetEditModal, type EditTarget } from './_components/timesheet-edit-modal';
import { AttendanceScoreCard } from '@/components/hr/attendance-score-card';
import type { ScoreConfig } from '@/lib/hr/attendance-score';

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

export default function HrTimesheetPage() {
  const t = useTranslations('hr.timesheet');

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [to, setTo] = useState<string>(() => openBusinessDateBangkok());
  const [from, setFrom] = useState<string>(() => addDaysStr(openBusinessDateBangkok(), -6));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scoreConfig, setScoreConfig] = useState<ScoreConfig | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

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
      if (j.score_config) setScoreConfig(j.score_config as ScoreConfig);
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
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
              {t('filterStore')}
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="control mt-1">
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
                className="control mt-1"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
              {t('filterTo')}
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="control mt-1"
              />
            </label>
          </>
        }
      />

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
                <SectionHeading title={emp.name} />
                <AttendanceScoreCard days={emp.days} today={openBusinessDateBangkok()} compact config={scoreConfig} />
                <SummaryChips totals={emp.totals} />
                {hasData ? (
                  <DayTable
                    days={emp.days}
                    onEditDay={(day) =>
                      setEditTarget({ userId: emp.user_id, name: emp.name, day })
                    }
                  />
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

      <TimesheetEditModal
        isOpen={!!editTarget}
        target={editTarget}
        storeId={storeId}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null);
          load();
        }}
      />
    </div>
  );
}
