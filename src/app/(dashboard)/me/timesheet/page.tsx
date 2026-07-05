'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { PageHeader, FilterBar, FilterField } from '@/components/ui';
import { openBusinessDateBangkok } from '@/lib/utils/date';
import {
  DayTable,
  SummaryChips,
  addDaysStr,
  isEmptyDay,
  type DaySummary,
  type TimesheetTotals,
} from '@/components/hr/timesheet-parts';
import { AttendanceScoreCard } from '@/components/hr/attendance-score-card';

interface EssTimesheet {
  from: string;
  to: string;
  work_hours_per_day: number;
  ot_eligible: boolean;
  days: DaySummary[];
  totals: TimesheetTotals;
  score_config?: import('@/lib/hr/attendance-score').ScoreConfig;
}

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
      <PageHeader
        title={t('myTitle')}
        subtitle={t('mySubtitle')}
        actions={
          <FilterBar>
            <FilterField label={t('filterFrom')}>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="control"
              />
            </FilterField>
            <FilterField label={t('filterTo')}>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="control"
              />
            </FilterField>
          </FilterBar>
        }
      />

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
          <AttendanceScoreCard days={data.days} today={openBusinessDateBangkok()} config={data.score_config} />
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
