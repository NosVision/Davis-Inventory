'use client';

import { useMemo } from 'react';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { isEmptyDay, type DaySummary, type TimesheetTotals } from '@/components/hr/timesheet-parts';
import { PayrollScopeChips, type PayrollScopeInfo } from '@/components/hr/payroll-scope-chips';
import { openBusinessDateBangkok } from '@/lib/utils/date';

// Extra timesheet presentations for /hr/timesheet (owner ask 2026-07-08): a colour-block grid
// (employees × days, same visual language as the bulk-backfill grid) and a compact one-row-per
// -employee summary table. The existing full per-day tables remain the third ("full") view.

export type TimesheetEmployee = PayrollScopeInfo & {
  user_id: string;
  name: string;
  /** profiles.display_name — offered on hover only; it is not always a person's name. */
  nickname?: string | null;
  company_id: string | null;
  work_hours_per_day: number;
  ot_eligible: boolean;
  /** hr_employees.pay_type — day-rated staff are paid worked_days × rate. */
  pay_type: string | null;
  /** Set only for departed (resigned/terminated) staff — their last working day. The API keeps
   *  a leaver visible while the viewed period overlaps their employment, then drops them. */
  end_date?: string | null;
  days: DaySummary[];
  totals: TimesheetTotals;
};

/** Small rose chip marking a departed employee's row (shown while their final period is viewed). */
export function DepartedChip({ endDate, isTh }: { endDate: string; isTh: boolean }) {
  return (
    <span
      className="ml-1 inline-flex shrink-0 items-center rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-medium text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"
      title={`${isTh ? 'วันทำงานสุดท้าย' : 'Last working day'}: ${endDate}`}
    >
      {isTh ? 'พ้นสภาพ' : 'departed'}
    </span>
  );
}

/** Tooltip naming the venue's nickname for someone, when it differs from the name on the row. */
export function nickTitle(emp: TimesheetEmployee, isTh: boolean): string | undefined {
  const nick = emp.nickname?.trim();
  if (!nick || nick === emp.name) return undefined;
  return `${isTh ? 'ชื่อเล่น' : 'Nickname'}: ${nick}`;
}

export type DayStatus =
  | 'normal'
  | 'late'
  | 'absent'
  | 'leave'
  | 'dayoff'
  | 'wod'
  | 'incomplete'
  | 'working'
  | 'empty';

// Collapse a derived day into ONE headline status for the block grid. Order matters: the most
// notable condition wins (leave > absent > no-clock-out > late > worked). OT/override are overlays.
// A day carried purely by an HR override (bulk backfill / manual entry) has no schedule row or
// punch, so it is read from the override's worked/absent/late fields rather than first_in.
/**
 * @param today the CURRENT business date (Bangkok, 6am cutoff). An open shift on that date is
 *   someone still at work, not a missing clock-out — without it every person mid-shift showed
 *   the orange "no clock-out" flag.
 *
 * `incomplete` is deliberately ranked LAST of the worked states: a day that was both late and
 * never clocked out used to render as "!" only, hiding the late status that actually costs money.
 * The grid re-surfaces the missing clock-out as a corner badge instead.
 */
export function deriveDayStatus(d: DaySummary, today?: string): DayStatus {
  if (d.leave) return 'leave';
  if (isEmptyDay(d)) return 'empty';
  if (d.absent) return 'absent';
  if (d.is_day_off && !d.worked_on_day_off) return 'dayoff';
  if (d.incomplete && d.business_date === today) return 'working';
  if (d.worked_on_day_off) return 'wod';
  if ((d.late_min ?? 0) > 0) return 'late';
  if (d.incomplete) return 'incomplete';
  if (d.first_in) return 'normal';
  if ((d.worked_min ?? 0) > 0) return 'normal'; // override-set working day (no punch)
  if (d.scheduled) return 'normal';
  if (d.overridden) return 'dayoff'; // overridden, worked 0, not absent → a marked day off
  return 'empty';
}

export const STYLE_TH: Record<Exclude<DayStatus, 'empty'>, { block: string; glyph: string; dot: string; label: string }> = {
  normal: { block: 'bg-emerald-400/90 text-white ring-emerald-500', glyph: 'ป', dot: 'bg-emerald-400', label: 'ปกติ' },
  late: { block: 'bg-amber-400/90 text-white ring-amber-500', glyph: 'ส', dot: 'bg-amber-400', label: 'มาสาย' },
  absent: { block: 'bg-red-400/90 text-white ring-red-500', glyph: 'ข', dot: 'bg-red-400', label: 'ขาด' },
  leave: { block: 'bg-violet-400/90 text-white ring-violet-500', glyph: 'ล', dot: 'bg-violet-400', label: 'ลา' },
  dayoff: { block: 'bg-gray-300 text-gray-600 ring-gray-400 dark:bg-gray-600 dark:text-gray-200', glyph: 'ห', dot: 'bg-gray-400', label: 'วันหยุด' },
  wod: { block: 'bg-sky-400/90 text-white ring-sky-500', glyph: 'ท', dot: 'bg-sky-400', label: 'ทำวันหยุด' },
  incomplete: { block: 'bg-orange-400/90 text-white ring-orange-500', glyph: '!', dot: 'bg-orange-400', label: 'ไม่ออกงาน' },
  working: { block: 'bg-blue-400/90 text-white ring-blue-500', glyph: 'ก', dot: 'bg-blue-400', label: 'กำลังทำงาน' },
};

export const STYLE_EN: Record<Exclude<DayStatus, 'empty'>, { block: string; glyph: string; dot: string; label: string }> = {
  normal: { block: 'bg-emerald-400/90 text-white ring-emerald-500', glyph: 'N', dot: 'bg-emerald-400', label: 'Normal' },
  late: { block: 'bg-amber-400/90 text-white ring-amber-500', glyph: 'T', dot: 'bg-amber-400', label: 'Late' },
  absent: { block: 'bg-red-400/90 text-white ring-red-500', glyph: 'A', dot: 'bg-red-400', label: 'Absent' },
  leave: { block: 'bg-violet-400/90 text-white ring-violet-500', glyph: 'L', dot: 'bg-violet-400', label: 'Leave' },
  dayoff: { block: 'bg-gray-300 text-gray-600 ring-gray-400 dark:bg-gray-600 dark:text-gray-200', glyph: 'O', dot: 'bg-gray-400', label: 'Day off' },
  wod: { block: 'bg-sky-400/90 text-white ring-sky-500', glyph: 'W', dot: 'bg-sky-400', label: 'Worked day off' },
  incomplete: { block: 'bg-orange-400/90 text-white ring-orange-500', glyph: '!', dot: 'bg-orange-400', label: 'No clock-out' },
  working: { block: 'bg-blue-400/90 text-white ring-blue-500', glyph: 'IN', dot: 'bg-blue-400', label: 'On shift' },
};

export const STYLE = STYLE_TH;

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
  onPickEmployee,
  homeCompany = null,
}: {
  employees: TimesheetEmployee[];
  onPick: (emp: TimesheetEmployee, day: DaySummary) => void;
  /** Opens the period summary for one person — the name cell, as opposed to a day block. */
  onPickEmployee?: (emp: TimesheetEmployee) => void;
  /** The venue's own company — only OTHER companies get named on a row. See PayrollScopeChips. */
  homeCompany?: string | null;
}) {
  const isTh = useLocale() === 'th';
  const wd = isTh ? WD_TH : WD_EN;
  const localeStyle = isTh ? STYLE_TH : STYLE_EN;
  const LEGEND: Exclude<DayStatus, 'empty'>[] = ['normal', 'working', 'late', 'absent', 'leave', 'wod', 'incomplete', 'dayoff'];

  // Bangkok business date (6am cutoff) — a night shift started at 22:00 stays "today" until 6am.
  const today = openBusinessDateBangkok();

  const dates = useMemo(() => employees[0]?.days.map((d) => d.business_date) ?? [], [employees]);

  // The name column carries chips only when there is something to explain — widen it just then,
  // rather than permanently spending horizontal space the day blocks need.
  const hasScopeChips = useMemo(
    () =>
      employees.some(
        (e) => e.payroll_group_name || (e.company_name && e.company_name !== homeCompany)
      ),
    [homeCompany, employees]
  );
  const nameColWidth = hasScopeChips ? 'min-w-[13rem] max-w-[13rem]' : 'min-w-[9rem] max-w-[9rem]';

  return (
    <div className="space-y-2">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
        <span className="font-semibold">{isTh ? 'สีสถานะ' : 'Legend'}:</span>
        {LEGEND.map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <i className={cn('h-2.5 w-2.5 rounded-sm', localeStyle[s].dot)} />
            {localeStyle[s].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-violet-500" />OT</span>
      </div>

      <div className="max-h-[62vh] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th
                className={cn(
                  'sticky left-0 z-20 border-b border-r border-gray-200 bg-gray-50 px-2 py-1.5 text-left font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
                  nameColWidth
                )}
              >
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
                  <td
                    className={cn(
                      'sticky left-0 z-[5] border-b border-r border-gray-200 bg-white px-2 py-1 font-medium text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200',
                      nameColWidth
                    )}
                  >
                    <span className="flex items-center">
                      {/* The name opens this person's period summary; the day blocks stay the way
                          in to editing one day. */}
                      {onPickEmployee ? (
                        <button
                          type="button"
                          onClick={() => onPickEmployee(emp)}
                          title={
                            nickTitle(emp, isTh) ??
                            (isTh ? 'ดูสรุป ขาด/ลา/สาย ของช่วงนี้' : 'Absence, leave and lateness for this range')
                          }
                          className="truncate text-left hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
                        >
                          {emp.name}
                        </button>
                      ) : (
                        <span className="truncate" title={nickTitle(emp, isTh)}>{emp.name}</span>
                      )}
                      {emp.end_date && <DepartedChip endDate={emp.end_date} isTh={isTh} />}
                      <PayrollScopeChips emp={emp} homeCompany={homeCompany} isTh={isTh} />
                    </span>
                  </td>
                  {dates.map((date) => {
                    const day = byDate.get(date);
                    const status = day ? deriveDayStatus(day, today) : 'empty';
                    const hasOt = (day?.ot_min ?? 0) > 0;
                    const overridden = !!day?.overridden;
                    // A past day can be late AND missing its clock-out; the block shows the
                    // payroll-relevant status, this badge keeps the data-quality flag visible.
                    const missingOut = !!day?.incomplete && status !== 'incomplete' && status !== 'working';
                    return (
                      <td key={date} className="border-b border-gray-100 p-0.5 text-center dark:border-gray-700/60">
                        <button
                          type="button"
                          onClick={() => day && onPick(emp, day)}
                          disabled={!day}
                          title={
                            status === 'empty'
                              ? isTh ? 'คลิกเพื่อลงเวลา' : 'Click to log time'
                              : `${localeStyle[status].label}${status === 'leave' && day?.leave ? ` · ${isTh ? day.leave.name_th : day.leave.name_en}` : ''}${missingOut ? ` · ${isTh ? 'ไม่ออกงาน' : 'no clock-out'}` : ''}${(day?.late_min ?? 0) > 0 ? ` · สาย ${day?.late_min}` : ''}${(day?.ot_min ?? 0) > 0 ? ` · OT ${toH(day?.ot_min ?? 0)}` : ''}`
                          }
                          className={cn(
                            'relative mx-auto flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold ring-1 transition-transform hover:scale-110',
                            status === 'empty'
                              ? 'cursor-pointer bg-gray-50 text-gray-300 ring-gray-200 hover:bg-indigo-50 hover:text-indigo-400 dark:bg-gray-800 dark:text-gray-600 dark:ring-gray-700 dark:hover:bg-indigo-900/20'
                              : localeStyle[status].block,
                            overridden && 'ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-gray-900'
                          )}
                        >
                          {status === 'empty' ? '+' : localeStyle[status].glyph}
                          {hasOt && <i className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-violet-500 ring-1 ring-white dark:ring-gray-900" />}
                          {missingOut && (
                            <i className="absolute -left-0.5 -top-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-orange-500 text-[7px] font-bold not-italic leading-none text-white ring-1 ring-white dark:ring-gray-900">
                              !
                            </i>
                          )}
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
  homeCompany = null,
}: {
  employees: TimesheetEmployee[];
  onPick?: (emp: TimesheetEmployee) => void;
  /** The venue's own company — only OTHER companies get named on a row. See PayrollScopeChips. */
  homeCompany?: string | null;
}) {
  const isTh = useLocale() === 'th';
  const H = isTh
    ? { name: 'พนักงาน', workDays: 'วันทำงาน', hours: 'ชั่วโมง', ot: 'OT (ชม.)', late: 'สาย (นาที)', absent: 'ขาด', incomplete: 'ไม่ออกงาน' }
    : { name: 'Employee', workDays: 'Work days', hours: 'Hours', ot: 'OT (h)', late: 'Late (min)', absent: 'Absent', incomplete: 'No clock-out' };

  return (
    // Capped height so the column headers can pin: a venue runs to dozens of rows, and scrolling
    // past the header leaves five unlabelled number columns.
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="min-w-full text-sm">
        <thead>
          {/* Backgrounds sit on the cells, not the row — a sticky cell needs its own to paint over
              the rows passing beneath it. */}
          <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
            <th className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 px-3 py-2 font-medium dark:border-gray-700 dark:bg-gray-800">{H.name}</th>
            <th className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 px-3 py-2 text-right font-medium dark:border-gray-700 dark:bg-gray-800">{H.workDays}</th>
            <th className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 px-3 py-2 text-right font-medium dark:border-gray-700 dark:bg-gray-800">{H.hours}</th>
            <th className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 px-3 py-2 text-right font-medium dark:border-gray-700 dark:bg-gray-800">{H.ot}</th>
            <th className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 px-3 py-2 text-right font-medium dark:border-gray-700 dark:bg-gray-800">{H.late}</th>
            <th className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 px-3 py-2 text-right font-medium dark:border-gray-700 dark:bg-gray-800">{H.absent}</th>
            {/* Days clocked in but never out. Their hours and OT compute to zero, so a period closed
                on them silently underpays anyone paid by time — worth its own column beside ขาด. */}
            <th className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 px-3 py-2 text-right font-medium dark:border-gray-700 dark:bg-gray-800">{H.incomplete}</th>
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
              <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">
                <span title={nickTitle(emp, isTh)}>{emp.name}</span>
                {emp.end_date && <DepartedChip endDate={emp.end_date} isTh={isTh} />}
                <PayrollScopeChips emp={emp} homeCompany={homeCompany} isTh={isTh} />
              </td>
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
              <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                {emp.totals.incomplete_days > 0 ? <span className="font-medium text-orange-600 dark:text-orange-400">{emp.totals.incomplete_days}</span> : <span className="text-gray-400 dark:text-gray-600">0</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
