'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarDays, Loader2, ChevronLeft, ChevronRight, LayoutGrid, List } from 'lucide-react';
import { PageHeader, StatusBadge } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { todayBangkok } from '@/lib/utils/date';
import { formatThaiDate } from '@/lib/utils/format';

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
interface TsDay {
  business_date: string;
  is_day_off: boolean;
  absent: boolean;
  late_min: number | null;
  worked_min: number | null;
  first_in: string | null;
  worked_on_day_off: boolean;
  scheduled: boolean;
}
interface LeaveRow {
  from_date: string;
  to_date: string;
  status: string;
}

type DayStatus = 'normal' | 'late' | 'absent' | 'leave' | 'dayoff' | 'scheduled' | 'none';
type NamedStatus = Exclude<DayStatus, 'none'>;

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');
const pad2 = (n: number) => String(n).padStart(2, '0');

function addMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function firstWeekday(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).getDay();
}
function addDay(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export default function MySchedulePage() {
  const t = useTranslations('hr.schedule');
  const isTh = useLocale() === 'th';
  const today = todayBangkok();

  const [month, setMonth] = useState<string>(() => today.slice(0, 7));
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [sched, setSched] = useState<EssRow[]>([]);
  const [tsDays, setTsDays] = useState<TsDay[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const STATUS: Record<NamedStatus, { dot: string; label: string; tone: 'good' | 'warn' | 'critical' | 'info' | 'neutral' }> = {
    normal: { dot: 'bg-emerald-500', tone: 'good', label: isTh ? 'ปกติ' : 'Normal' },
    late: { dot: 'bg-amber-500', tone: 'warn', label: isTh ? 'มาสาย' : 'Late' },
    absent: { dot: 'bg-red-500', tone: 'critical', label: isTh ? 'ขาด' : 'Absent' },
    leave: { dot: 'bg-blue-500', tone: 'info', label: isTh ? 'ลา' : 'Leave' },
    dayoff: { dot: 'bg-gray-400', tone: 'neutral', label: isTh ? 'วันหยุด' : 'Day off' },
    scheduled: { dot: 'bg-indigo-400', tone: 'info', label: isTh ? 'มีกะ' : 'Scheduled' },
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const first = `${month}-01`;
    const last = `${month}-${pad2(daysInMonth(month))}`;
    try {
      const [sRes, tRes, lRes] = await Promise.all([
        fetch(`/api/hr/ess/schedule?month=${month}`),
        fetch(`/api/hr/ess/timesheet?from=${first}&to=${last}`),
        fetch('/api/hr/ess/leaves'),
      ]);
      setSched(sRes.ok ? (((await sRes.json()).data ?? []) as EssRow[]) : []);
      setTsDays(tRes.ok ? (((await tRes.json()).days ?? []) as TsDay[]) : []);
      setLeaves(lRes.ok ? (((await lRes.json()).data ?? []) as LeaveRow[]) : []);
    } catch {
      setSched([]);
      setTsDays([]);
      setLeaves([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);
  useEffect(() => {
    setSelected(null);
  }, [month]);

  const schedByDate = useMemo(() => new Map(sched.map((r) => [r.work_date, r])), [sched]);
  const tsByDate = useMemo(() => new Map(tsDays.map((d) => [d.business_date, d])), [tsDays]);
  const leaveDates = useMemo(() => {
    const set = new Set<string>();
    for (const lv of leaves) {
      if (lv.status !== 'approved') continue;
      let cur = lv.from_date;
      for (let i = 0; i < 400 && cur <= lv.to_date; i++) {
        set.add(cur);
        cur = addDay(cur, 1);
      }
    }
    return set;
  }, [leaves]);

  const statusOf = useCallback(
    (date: string): DayStatus => {
      if (leaveDates.has(date)) return 'leave';
      const ts = tsByDate.get(date);
      const s = schedByDate.get(date);
      const future = date > today;
      const isToday = date === today;

      if (future) {
        if (s?.is_day_off || ts?.is_day_off) return 'dayoff';
        if (s?.shift) return 'scheduled';
        return 'none';
      }
      // Past or today
      if (ts) {
        if (ts.is_day_off && !ts.worked_on_day_off) return 'dayoff';
        if (ts.first_in || ts.worked_on_day_off) return (ts.late_min ?? 0) > 0 ? 'late' : 'normal';
        if (ts.absent) return isToday ? (s?.shift ? 'scheduled' : 'none') : 'absent';
      }
      if (s?.is_day_off) return 'dayoff';
      if (s?.shift) return isToday ? 'scheduled' : 'none';
      return 'none';
    },
    [leaveDates, tsByDate, schedByDate, today]
  );

  const weekdays = isTh ? ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return new Intl.DateTimeFormat(isTh ? 'th-TH' : 'en-US', { month: 'long', year: 'numeric' }).format(
      new Date(y, m - 1, 1)
    );
  }, [month, isTh]);

  // Days (of this month) that carry a status — for the list view.
  const listDays = useMemo(() => {
    const out: string[] = [];
    for (let d = 1; d <= daysInMonth(month); d++) {
      const date = `${month}-${pad2(d)}`;
      if (statusOf(date) !== 'none') out.push(date);
    }
    return out;
  }, [month, statusOf]);

  const dayNum = (date: string) => Number(date.split('-')[2]);
  const weekdayOf = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return weekdays[new Date(y, m - 1, d).getDay()];
  };

  const renderDetail = () => {
    if (!selected) return null;
    const st = statusOf(selected);
    const s = schedByDate.get(selected);
    const ts = tsByDate.get(selected);
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatThaiDate(selected)}</span>
          {st !== 'none' && <StatusBadge tone={STATUS[st].tone} label={STATUS[st].label} />}
        </div>
        {s && !s.is_day_off && s.shift ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.shift.color || '#6366f1' }} />
            <span className="font-medium">{s.shift.label || '—'}</span>
            <span className="tabular-nums text-gray-500 dark:text-gray-400">
              {hhmm(s.shift.start_time)}–{hhmm(s.shift.end_time)}
            </span>
          </div>
        ) : null}
        {ts && ts.first_in && (ts.late_min ?? 0) > 0 && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {isTh ? `มาสาย ${ts.late_min} นาที` : `Late ${ts.late_min} min`}
          </p>
        )}
        {st === 'none' && (
          <p className="mt-1 text-xs text-gray-400">{isTh ? 'ไม่มีข้อมูล' : 'No data'}</p>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <PageHeader
        title={t('myScheduleTitle')}
        subtitle={t('mySubtitle')}
        actions={
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
            {([['calendar', LayoutGrid], ['list', List]] as const).map(([v, Icon]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                  view === v
                    ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-700 dark:text-indigo-300'
                    : 'text-gray-500 dark:text-gray-400'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v === 'calendar' ? (isTh ? 'ปฏิทิน' : 'Calendar') : isTh ? 'รายการ' : 'List'}
              </button>
            ))}
          </div>
        }
      />

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth((m) => addMonth(m, -1))}
          className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          aria-label="prev month"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{monthLabel}</span>
        <button
          type="button"
          onClick={() => setMonth((m) => addMonth(m, 1))}
          className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          aria-label="next month"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
        {(['normal', 'late', 'absent', 'leave', 'dayoff'] as NamedStatus[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <i className={cn('h-2 w-2 rounded-full', STATUS[k].dot)} />
            {STATUS[k].label}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : view === 'calendar' ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-2.5 dark:border-gray-700 dark:bg-gray-800">
            <div className="grid grid-cols-7 gap-1">
              {weekdays.map((w, i) => (
                <div
                  key={w}
                  className={cn(
                    'py-1 text-center text-[11px] font-medium',
                    i === 0 || i === 6 ? 'text-rose-400' : 'text-gray-400 dark:text-gray-500'
                  )}
                >
                  {w}
                </div>
              ))}
              {Array.from({ length: firstWeekday(month) }).map((_, i) => (
                <div key={`blank-${i}`} />
              ))}
              {Array.from({ length: daysInMonth(month) }).map((_, i) => {
                const dd = i + 1;
                const date = `${month}-${pad2(dd)}`;
                const st = statusOf(date);
                const isToday = date === today;
                const isSel = date === selected;
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setSelected(date)}
                    className={cn(
                      'flex aspect-square flex-col items-center justify-center gap-1 rounded-lg text-sm transition-colors',
                      isSel
                        ? 'bg-indigo-50 ring-2 ring-indigo-400 dark:bg-indigo-900/30'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800',
                      isToday && !isSel && 'ring-1 ring-indigo-300 dark:ring-indigo-700'
                    )}
                  >
                    <span
                      className={cn(
                        'tabular-nums',
                        isToday
                          ? 'font-bold text-indigo-600 dark:text-indigo-300'
                          : 'text-gray-700 dark:text-gray-200'
                      )}
                    >
                      {dd}
                    </span>
                    <span className={cn('h-1.5 w-1.5 rounded-full', st !== 'none' ? STATUS[st].dot : 'bg-transparent')} />
                  </button>
                );
              })}
            </div>
          </div>
          {renderDetail()}
        </div>
      ) : listDays.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
          <CalendarDays className="h-8 w-8" />
          {t('noSchedule')}
        </div>
      ) : (
        <ul className="space-y-2">
          {listDays.map((date) => {
            const st = statusOf(date);
            const s = schedByDate.get(date);
            return (
              <li
                key={date}
                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
                  <span className="text-[10px] uppercase text-gray-400 dark:text-gray-500">{weekdayOf(date)}</span>
                  <span className="text-base font-semibold tabular-nums text-gray-900 dark:text-white">
                    {dayNum(date)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  {s && !s.is_day_off && s.shift ? (
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: s.shift.color || '#6366f1' }}
                      />
                      <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                        {s.shift.label || '—'}
                      </span>
                      <span className="whitespace-nowrap text-xs tabular-nums text-gray-500 dark:text-gray-400">
                        {hhmm(s.shift.start_time)}–{hhmm(s.shift.end_time)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      {st === 'dayoff' ? STATUS.dayoff.label : st !== 'none' ? STATUS[st].label : '—'}
                    </span>
                  )}
                </div>
                {st !== 'none' && <StatusBadge tone={STATUS[st].tone} label={STATUS[st].label} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
