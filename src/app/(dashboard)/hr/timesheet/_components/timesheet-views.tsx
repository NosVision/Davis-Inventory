'use client';

import { useMemo } from 'react';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { isEmptyDay, type DaySummary, type TimesheetTotals } from '@/components/hr/timesheet-parts';

// Extra timesheet presentations for /hr/timesheet (owner ask 2026-07-08): a colour-block grid
// (employees × days, same visual language as the bulk-backfill grid) and a compact one-row-per
// -employee summary table. The existing full per-day tables remain the third ("full") view.

export type TimesheetEmployee = {
  user_id: string;
  name: string;
  company_id: string | null;
  work_hours_per_day: number;
  ot_eligible: boolean;
  days: DaySummary[];
  totals: TimesheetTotals;
};

export type DayStatus =
  | 'normal'
  | 'late'
  | 'absent'
  | 'leave'
  | 'dayoff'
  | 'wod'
  | 'incomplete'
  | 'empty';

// Collapse a derived day into ONE headline status for the block grid. Order matters: the most
// notable condition wins (leave > absent > no-clock-out > late > worked). OT/override are overlays.
// A day carried purely by an HR override (bulk backfill / manual entry) has no schedule row or
// punch, so it is read from the override's worked/absent/late fields rather than first_in.
export function deriveDayStatus(d: DaySummary): DayStatus {
  if (d.leave) return 'leave';
  if (isEmptyDay(d)) return 'empty';
  if (d.absent) return 'absent';
  if (d.is_day_off && !d.worked_on_day_off) return 'dayoff';
  if (d.incomplete) return 'incomplete';
  if (d.worked_on_day_off) return 'wod';
  if ((d.late_min ?? 0) > 0) return 'late';
  if (d.first_in) return 'normal';
  if ((d.worked_min ?? 0) > 0) return 'normal'; // override-set working day (no punch)
  if (d.scheduled) return 'normal';
  if (d.overridden) return 'dayoff'; // overridden, worked 0, not absent → a marked day off
  return 'empty';
}

const toH = (min: number) => (min / 60).toFixed(1);
const WD_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const WD_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function weekdayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

// ── Block grid ─────────────────────────────────────────────────────────────
export function TimesheetBlockGrid({
  employees,
  onPick,
}: {
  employees: TimesheetEmployee[];
  onPick: (emp: TimesheetEmployee, day: DaySummary) => void;
}) {
  const isTh = useLocale() === 'th';
  const wd = isTh ? WD_TH : WD_EN;

  const STYLE: Record<Exclude<DayStatus, 'empty'>, { block: string; glyph: string; dot: string; label: string }> = {
    normal: { block: 'bg-emerald-400/90 text-white ring-emerald-500', glyph: isTh ? 'ป' : 'N', dot: 'bg-emerald-400', label: isTh ? 'ปกติ' : 'Normal' },
    late: { block: 'bg-amber-400/90 text-white ring-amber-500', glyph: isTh ? 'ส' : 'T', dot: 'bg-amber-400', label: isTh ? 'มาสาย' : 'Late' },
    absent: { block: 'bg-red-400/90 text-white ring-red-500', glyph: isTh ? 'ข' : 'A', dot: 'bg-red-400', label: isTh ? 'ขาด' : 'Absent' },
    leave: { block: 'bg-violet-400/90 text-white ring-violet-500', glyph: isTh ? 'ล' : 'L', dot: 'bg-violet-400', label: isTh ? 'ลา' : 'Leave' },
    dayoff: { block: 'bg-gray-300 text-gray-600 ring-gray-400 dark:bg-gray-600 dark:text-gray-200', glyph: isTh ? 'ห' : 'O', dot: 'bg-gray-400', label: isTh ? 'วันหยุด' : 'Day off' },
    wod: { block: 'bg-sky-400/90 text-white ring-sky-500', glyph: isTh ? 'ท' : 'W', dot: 'bg-sky-400', label: isTh ? 'ทำวันหยุด' : 'Worked day off' },
    incomplete: { block: 'bg-orange-400/90 text-white ring-orange-500', glyph: '!', dot: 'bg-orange-400', label: isTh ? 'ไม่ออกงาน' : 'No clock-out' },
  };
  const LEGEND: Exclude<DayStatus, 'empty'>[] = ['normal', 'late', 'absent', 'leave', 'wod', 'incomplete', 'dayoff'];

  const dates = useMemo(() => employees[0]?.days.map((d) => d.business_date) ?? [], [employees]);

  return (
    <div className="space-y-2">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
        <span className="font-semibold">{isTh ? 'สีสถานะ' : 'Legend'}:</span>
        {LEGEND.map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <i className={cn('h-2.5 w-2.5 rounded-sm', STYLE[s].dot)} />
            {STYLE[s].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-violet-500" />OT</span>
      </div>

      <div className="max-h-[62vh] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 min-w-[9rem] border-b border-r border-gray-200 bg-gray-50 px-2 py-1.5 text-left font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                {isTh ? 'พนักงาน' : 'Employee'}
              </th>
              {dates.map((d) => {
                const wi = weekdayIndex(d);
                const weekend = wi === 0 || wi === 6;
                return (
                  <th
                    key={d}
                    className={cn(
                      'border-b border-gray-200 px-0.5 py-1 text-center font-medium dark:border-gray-700',
                      weekend ? 'bg-gray-100 text-rose-400 dark:bg-gray-800/80' : 'bg-gray-50 text-gray-500 dark:bg-gray-800'
                    )}
                  >
                    <div className="tabular-nums">{Number(d.split('-')[2])}</div>
                    <div className="text-[9px] opacity-70">{wd[wi]}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => {
              const byDate = new Map(emp.days.map((d) => [d.business_date, d]));
              return (
                <tr key={emp.user_id}>
                  <td className="sticky left-0 z-[5] min-w-[9rem] max-w-[9rem] truncate border-b border-r border-gray-200 bg-white px-2 py-1 font-medium text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                    {emp.name}
                  </td>
                  {dates.map((date) => {
                    const day = byDate.get(date);
                    const status = day ? deriveDayStatus(day) : 'empty';
                    const hasOt = (day?.ot_min ?? 0) > 0;
                    const overridden = !!day?.overridden;
                    return (
                      <td key={date} className="border-b border-gray-100 p-0.5 text-center dark:border-gray-700/60">
                        <button
                          type="button"
                          onClick={() => day && onPick(emp, day)}
                          disabled={!day}
                          title={
                            status === 'empty'
                              ? isTh ? 'คลิกเพื่อลงเวลา' : 'Click to log time'
                              : `${STYLE[status].label}${status === 'leave' && day?.leave ? ` · ${isTh ? day.leave.name_th : day.leave.name_en}` : ''}${(day?.late_min ?? 0) > 0 ? ` · สาย ${day?.late_min}` : ''}${(day?.ot_min ?? 0) > 0 ? ` · OT ${toH(day?.ot_min ?? 0)}` : ''}`
                          }
                          className={cn(
                            'relative mx-auto flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold ring-1 transition-transform hover:scale-110',
                            status === 'empty'
                              ? 'cursor-pointer bg-gray-50 text-gray-300 ring-gray-200 hover:bg-indigo-50 hover:text-indigo-400 dark:bg-gray-800 dark:text-gray-600 dark:ring-gray-700 dark:hover:bg-indigo-900/20'
                              : STYLE[status].block,
                            overridden && 'ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-gray-900'
                          )}
                        >
                          {status === 'empty' ? '+' : STYLE[status].glyph}
                          {hasOt && <i className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-violet-500 ring-1 ring-white dark:ring-gray-900" />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Summary table ────────────────────────────────────────────────────────────
export function TimesheetSummaryTable({
  employees,
  onPick,
}: {
  employees: TimesheetEmployee[];
  onPick?: (emp: TimesheetEmployee) => void;
}) {
  const isTh = useLocale() === 'th';
  const H = isTh
    ? { name: 'พนักงาน', workDays: 'วันทำงาน', hours: 'ชั่วโมง', ot: 'OT (ชม.)', late: 'สาย (นาที)', absent: 'ขาด' }
    : { name: 'Employee', workDays: 'Work days', hours: 'Hours', ot: 'OT (h)', late: 'Late (min)', absent: 'Absent' };

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            <th className="px-3 py-2 font-medium">{H.name}</th>
            <th className="px-3 py-2 text-right font-medium">{H.workDays}</th>
            <th className="px-3 py-2 text-right font-medium">{H.hours}</th>
            <th className="px-3 py-2 text-right font-medium">{H.ot}</th>
            <th className="px-3 py-2 text-right font-medium">{H.late}</th>
            <th className="px-3 py-2 text-right font-medium">{H.absent}</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <tr
              key={emp.user_id}
              onClick={() => onPick?.(emp)}
              className={cn(
                'border-t border-gray-100 dark:border-gray-700/50',
                onPick && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50'
              )}
            >
              <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{emp.name}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{emp.totals.work_days}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{toH(emp.totals.worked_min)}</td>
              {/* An OT-ineligible employee is paid 0 OT by payroll.ts regardless of stored minutes —
                  say so here instead of showing a bare "—" that reads like "worked no OT". */}
              <td className="px-3 py-2 text-right tabular-nums">
                {!emp.ot_eligible ? (
                  <span
                    className="text-xs text-gray-400 dark:text-gray-600"
                    title={isTh ? 'พนักงานคนนี้ไม่มีสิทธิ์ OT' : 'This employee is not OT-eligible'}
                  >
                    {isTh ? 'ไม่มีสิทธิ์' : 'n/a'}
                  </span>
                ) : emp.totals.ot_min > 0 ? (
                  <span className="font-medium text-violet-600 dark:text-violet-400">{toH(emp.totals.ot_min)}</span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-600">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {emp.totals.late_min > 0 ? <span className="font-medium text-amber-600 dark:text-amber-400">{emp.totals.late_min}</span> : <span className="text-gray-400 dark:text-gray-600">0</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {emp.totals.absent_days > 0 ? <span className="font-medium text-red-600 dark:text-red-400">{emp.totals.absent_days}</span> : <span className="text-gray-400 dark:text-gray-600">0</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
