'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, Loader2 } from 'lucide-react';
import { PageHeader, StatusBadge } from '@/components/ui';
import { todayBangkok } from '@/lib/utils/date';

interface EssShift {
  label: string | null;
  start_time: string | null;
  end_time: string | null;
  color: string | null;
}
interface EssRow {
  work_date: string;
  is_day_off: boolean;
  status: string;
  note: string | null;
  shift: EssShift | null;
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

// weekday label from a YYYY-MM-DD string (Bangkok-agnostic; date-only)
function weekday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return names[new Date(y, m - 1, d).getDay()];
}
const dayNum = (dateStr: string) => Number(dateStr.split('-')[2]);

export default function MySchedulePage() {
  const t = useTranslations('hr.schedule');
  const [month, setMonth] = useState<string>(() => todayBangkok().slice(0, 7));
  const [rows, setRows] = useState<EssRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/ess/schedule?month=${month}`);
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setRows((json.data ?? []) as EssRow[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <PageHeader
        title={t('myScheduleTitle')}
        subtitle={t('mySubtitle')}
        actions={
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="control"
          />
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
          <CalendarDays className="h-8 w-8" />
          {t('noSchedule')}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.work_date}
              className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
                <span className="text-[10px] uppercase text-gray-400 dark:text-gray-500">
                  {weekday(r.work_date)}
                </span>
                <span className="text-base font-semibold tabular-nums text-gray-900 dark:text-white">
                  {dayNum(r.work_date)}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                {r.is_day_off ? (
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t('dayOff')}
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: r.shift?.color || '#6366f1' }}
                    />
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                      {r.shift?.label || '—'}
                    </span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-gray-500 dark:text-gray-400">
                      {hhmm(r.shift?.start_time ?? null)}–{hhmm(r.shift?.end_time ?? null)}
                    </span>
                  </div>
                )}
              </div>
              <StatusBadge
                tone={r.status === 'acknowledged' ? 'good' : 'info'}
                label={r.status === 'acknowledged' ? t('statusAcknowledged') : t('statusSubmitted')}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
