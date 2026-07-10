'use client';

/**
 * Shared read-only presentation for the HR Timesheet feature (§J8 / P2.4a).
 * Consumed by both the manager view (/hr/timesheet) and the ESS view
 * (/me/timesheet). All metrics are MINUTES + flags — no money (payroll is P4).
 * Both callers use the `hr.timesheet` i18n namespace.
 */

import { useTranslations, useLocale } from 'next-intl';
import { Pencil } from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { formatTimeBangkok } from '@/lib/utils/date';

/** An approved leave covering this day, surfaced so the UI shows "ลา (type)" not "ขาด". */
export interface DayLeave {
  id: string;
  code: string;
  name_th: string;
  name_en: string;
}

export interface DaySummary {
  business_date: string;
  scheduled: boolean;
  is_day_off: boolean;
  first_in: string | null;
  last_out: string | null;
  worked_min: number | null;
  break_min: number;
  late_min: number | null;
  ot_min: number;
  absent: boolean;
  incomplete: boolean;
  worked_on_day_off: boolean;
  overridden: boolean; // an HR override is layered over the derived metrics (§J8)
  override_reason: string | null; // the reason HR gave for the override
  leave?: DayLeave | null; // an approved leave covering this day (owner ask 2026-07-10)
}

export interface TimesheetTotals {
  work_days: number;
  absent_days: number;
  late_days: number;
  worked_min: number;
  ot_min: number;
  late_min: number;
  break_min: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}
const dayNum = (dateStr: string) => Number(dateStr.split('-')[2]);
const toH = (min: number) => (min / 60).toFixed(1);

/** Add `delta` calendar days to a YYYY-MM-DD string (UTC-safe, date-only). */
export function addDaysStr(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/**
 * A day with no schedule, no day-off, no punches, no leave AND no HR override is empty
 * noise — dim it. An override (e.g. a bulk backfill / manual entry) is intentional data, so
 * such a day is NOT empty even though it has no schedule row or punch.
 */
export function isEmptyDay(d: DaySummary): boolean {
  return !d.scheduled && !d.is_day_off && !d.first_in && !d.last_out && !d.leave && !d.overridden;
}

// ---------------------------------------------------------------------------

export function SummaryChips({ totals }: { totals: TimesheetTotals }) {
  const t = useTranslations('hr.timesheet');
  const chips = [
    { label: t('workDays'), value: String(totals.work_days) },
    { label: t('workedHours'), value: `${toH(totals.worked_min)}${t('hours')}` },
    { label: t('otHours'), value: `${toH(totals.ot_min)}${t('hours')}` },
    { label: t('lateMinutes'), value: `${totals.late_min}${t('minutes')}` },
    { label: t('absentDays'), value: String(totals.absent_days) },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <span
          key={c.label}
          className="inline-flex items-baseline gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1 text-xs dark:bg-gray-800"
        >
          <span className="text-gray-500 dark:text-gray-400">{c.label}</span>
          <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{c.value}</span>
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatusCell({ d }: { d: DaySummary }) {
  const t = useTranslations('hr.timesheet');
  const isTh = useLocale() === 'th';
  const badges: React.ReactNode[] = [];

  // An approved leave takes precedence over the absent/day-off badges.
  if (d.leave) {
    const name = isTh ? d.leave.name_th : d.leave.name_en;
    badges.push(
      <Badge key="leave" variant="info" size="sm" className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
        {t('leave')}{name ? ` · ${name}` : ''}
      </Badge>
    );
  }
  if (d.worked_on_day_off) {
    badges.push(
      <Badge key="wod" variant="info" size="sm">
        {t('workedOnDayOff')}
      </Badge>
    );
  } else if (d.is_day_off) {
    badges.push(
      <Badge key="off" variant="default" size="sm">
        {t('dayOff')}
      </Badge>
    );
  }
  if (d.absent) {
    badges.push(
      <Badge key="abs" variant="danger" size="sm">
        {t('absent')}
      </Badge>
    );
  }
  if (d.incomplete) {
    badges.push(
      <Badge key="inc" variant="warning" size="sm">
        {t('noClockOut')}
      </Badge>
    );
  }
  if ((d.late_min ?? 0) > 0) {
    badges.push(
      <Badge key="late" variant="warning" size="sm">
        {t('late')}
      </Badge>
    );
  }
  if (!d.scheduled && !d.is_day_off && (d.first_in || d.last_out)) {
    badges.push(
      <Badge key="ns" variant="outline" size="sm">
        {t('notScheduled')}
      </Badge>
    );
  }
  if (d.overridden) {
    badges.push(
      <span key="ovr" title={d.override_reason ?? undefined} className="inline-flex">
        <Badge variant="info" size="sm">
          {t('overridden')}
        </Badge>
      </span>
    );
  }

  // An overridden working day (bulk backfill / manual entry) has no punch, so it wouldn't
  // otherwise show the green "present" dot punched days get. Add it so the row reads as worked.
  const isWorkedDay = (d.first_in != null || (d.worked_min ?? 0) > 0) && !d.absent;
  if (isWorkedDay && !d.is_day_off && !d.incomplete && (d.late_min ?? 0) === 0 && badges.length > 0) {
    badges.unshift(
      <span key="ok" className="text-emerald-500 dark:text-emerald-400" aria-hidden>
        ●
      </span>
    );
  }

  if (badges.length === 0) {
    return d.scheduled ? (
      <span className="text-emerald-500 dark:text-emerald-400" aria-hidden>
        ●
      </span>
    ) : (
      <span className="text-gray-300 dark:text-gray-600">—</span>
    );
  }
  return <div className="flex flex-wrap gap-1">{badges}</div>;
}

export function DayTable({
  days,
  onEditDay,
}: {
  days: DaySummary[];
  /** When provided (HR/manager view), each day row gets a pencil edit affordance. */
  onEditDay?: (day: DaySummary) => void;
}) {
  const t = useTranslations('hr.timesheet');
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <th className="px-3 py-2 font-medium">{t('colDate')}</th>
            <th className="px-3 py-2 font-medium">{t('colShift')}</th>
            <th className="px-3 py-2 font-medium">{t('colIn')}</th>
            <th className="px-3 py-2 font-medium">{t('colOut')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('colWorked')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('colLate')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('colOt')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('colBreak')}</th>
            {onEditDay && (
              <th className="px-3 py-2 text-right font-medium">
                <span className="sr-only">{t('edit')}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const empty = isEmptyDay(d);
            return (
              <tr
                key={d.business_date}
                className={cn(
                  'border-t border-gray-100 dark:border-gray-700/50',
                  empty && 'opacity-40'
                )}
              >
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="mr-1 text-[10px] uppercase text-gray-400 dark:text-gray-500">
                    {weekday(d.business_date)}
                  </span>
                  <span className="font-medium tabular-nums text-gray-800 dark:text-gray-200">
                    {dayNum(d.business_date)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <StatusCell d={d} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600 dark:text-gray-400">
                  {d.first_in ? formatTimeBangkok(d.first_in) : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600 dark:text-gray-400">
                  {d.last_out ? formatTimeBangkok(d.last_out) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-800 dark:text-gray-200">
                  {d.worked_min != null ? toH(d.worked_min) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {d.late_min == null ? (
                    <span className="text-gray-300 dark:text-gray-600">—</span>
                  ) : d.late_min > 0 ? (
                    <span className="font-medium text-amber-600 dark:text-amber-400">{d.late_min}</span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">0</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-800 dark:text-gray-200">
                  {d.ot_min > 0 ? toH(d.ot_min) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">
                  {d.break_min > 0 ? d.break_min : '—'}
                </td>
                {onEditDay && (
                  <td className="px-3 py-2 text-right">
                    {!empty && (
                      <button
                        type="button"
                        onClick={() => onEditDay(d)}
                        title={t('edit')}
                        aria-label={t('edit')}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700 dark:hover:text-indigo-400"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
