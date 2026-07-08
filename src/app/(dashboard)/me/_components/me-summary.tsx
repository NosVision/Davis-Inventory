'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Clock, CheckCircle2, LogOut, CalendarOff, AlarmClock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { todayBangkok, formatTimeBangkok } from '@/lib/utils/date';

interface DaySummary {
  business_date: string;
  is_day_off: boolean;
  first_in: string | null;
  last_out: string | null;
  worked_min: number | null;
  late_min: number | null;
  absent: boolean;
  scheduled: boolean;
  ot_min: number;
}
interface Totals {
  work_days: number;
  absent_days: number;
  late_days: number;
  worked_min: number;
  ot_min: number;
}

// The pay cycle runs the 26th → 25th; this returns the current cycle's start up to today.
function cycleFrom(today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  const startMs = d >= 26 ? Date.UTC(y, m - 1, 26) : Date.UTC(y, m - 2, 26);
  return new Date(startMs).toISOString().slice(0, 10);
}
const toH = (min: number) => (min / 60).toFixed(1);

// Realtime "at a glance" summary on the employee home (owner ask 2026-07-08): today's attendance
// status + this pay-cycle totals, derived live from the ESS timesheet (schedule + punches).
export function MeSummary() {
  const isTh = useLocale() === 'th';
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<DaySummary | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = todayBangkok();
        const res = await fetch(`/api/hr/ess/timesheet?from=${cycleFrom(t)}&to=${t}`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!alive) return;
        const days = (json.days ?? []) as DaySummary[];
        setToday(days.find((d) => d.business_date === t) ?? null);
        setTotals((json.totals ?? null) as Totals | null);
      } catch {
        /* summary is best-effort */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white py-8 text-gray-300 dark:border-gray-700 dark:bg-gray-800">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  // Today's headline state.
  const state = (() => {
    if (today?.is_day_off) {
      return { icon: CalendarOff, tone: 'text-gray-500 dark:text-gray-400', label: isTh ? 'วันหยุด' : 'Day off', detail: '' };
    }
    if (today?.first_in && today?.last_out) {
      return {
        icon: LogOut,
        tone: 'text-emerald-600 dark:text-emerald-400',
        label: isTh ? 'ออกงานแล้ว' : 'Clocked out',
        detail: `${formatTimeBangkok(today.first_in)}–${formatTimeBangkok(today.last_out)} · ${toH(today.worked_min ?? 0)} ${isTh ? 'ชม.' : 'h'}`,
      };
    }
    if (today?.first_in) {
      const late = (today.late_min ?? 0) > 0;
      return {
        icon: CheckCircle2,
        tone: late ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400',
        label: isTh ? 'เข้างานแล้ว' : 'Clocked in',
        detail: `${formatTimeBangkok(today.first_in)}${late ? (isTh ? ` · สาย ${today.late_min} นาที` : ` · late ${today.late_min}m`) : ''}`,
      };
    }
    if (today?.scheduled) {
      return { icon: AlarmClock, tone: 'text-amber-600 dark:text-amber-400', label: isTh ? 'ยังไม่เข้างาน' : 'Not clocked in', detail: isTh ? 'มีกะวันนี้' : 'Scheduled today' };
    }
    return { icon: Clock, tone: 'text-gray-400', label: isTh ? 'วันนี้' : 'Today', detail: isTh ? 'ไม่มีกะ' : 'No shift' };
  })();

  const StateIcon = state.icon;
  const chips: { label: string; value: string; tone?: string }[] = totals
    ? [
        { label: isTh ? 'วันทำงาน' : 'Work days', value: String(totals.work_days) },
        { label: isTh ? 'ชั่วโมง' : 'Hours', value: toH(totals.worked_min) },
        { label: isTh ? 'สาย' : 'Late', value: `${totals.late_days} ${isTh ? 'วัน' : 'd'}`, tone: totals.late_days > 0 ? 'text-amber-600 dark:text-amber-400' : undefined },
        { label: isTh ? 'ขาด' : 'Absent', value: `${totals.absent_days} ${isTh ? 'วัน' : 'd'}`, tone: totals.absent_days > 0 ? 'text-red-600 dark:text-red-400' : undefined },
        { label: 'OT', value: `${toH(totals.ot_min)} ${isTh ? 'ชม.' : 'h'}` },
      ]
    : [];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      {/* Today */}
      <div className="flex items-center gap-3">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-50 dark:bg-gray-900/40', state.tone)}>
          <StateIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {isTh ? 'วันนี้' : 'Today'}
          </p>
          <p className={cn('text-sm font-semibold', state.tone)}>
            {state.label}
            {state.detail && (
              <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">· {state.detail}</span>
            )}
          </p>
        </div>
      </div>

      {/* Pay-cycle totals */}
      {chips.length > 0 && (
        <>
          <p className="mb-1.5 mt-3 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {isTh ? 'งวดนี้ (26–25)' : 'This cycle (26–25)'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span
                key={c.label}
                className="inline-flex items-baseline gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1 text-xs dark:bg-gray-700/60"
              >
                <span className="text-gray-500 dark:text-gray-400">{c.label}</span>
                <span className={cn('font-semibold tabular-nums text-gray-900 dark:text-white', c.tone)}>{c.value}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
