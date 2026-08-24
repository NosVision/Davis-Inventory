'use client';

import { useMemo } from 'react';
import { useLocale } from 'next-intl';
import { CalendarRange, ArrowRight } from 'lucide-react';
import { Modal, ModalFooter, Button } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { payWindows, type PayWindow } from '@/lib/hr/pay-cycle';
import type { TimesheetEmployee } from './timesheet-views';
import { isSameWindow, windowPurpose, windowTitle } from './pay-window-bar';

/**
 * One person's ขาด / ลา / สาย over the range on screen, plus WHICH payroll figure that range feeds.
 *
 * HR could already read the numbers off the summary table; what they could not read was whether a
 * given number was the one that docked the salary or the one that docked the SV — the two are
 * measured over different spans (see payWindows). The counts here are therefore only half the card:
 * the other half names the consumer and offers the other window in one tap.
 */

function dmy(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : date;
}

function Stat({
  label,
  value,
  tone = 'plain',
  hint,
}: {
  label: string;
  value: string | number;
  tone?: 'plain' | 'red' | 'violet' | 'amber' | 'orange' | 'emerald';
  hint?: string;
}) {
  const TONE = {
    plain: 'text-gray-700 dark:text-gray-200',
    red: 'text-red-600 dark:text-red-400',
    violet: 'text-violet-600 dark:text-violet-400',
    amber: 'text-amber-600 dark:text-amber-400',
    orange: 'text-orange-600 dark:text-orange-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
  } as const;
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
      title={hint}
    >
      <div className="text-[11px] text-gray-500 dark:text-gray-400">{label}</div>
      <div className={cn('text-lg font-bold tabular-nums', TONE[tone])}>{value}</div>
    </div>
  );
}

export function EmployeePeriodSummary({
  emp,
  from,
  to,
  payMonth,
  onClose,
  onPickWindow,
  onViewDays,
}: {
  emp: TimesheetEmployee;
  from: string;
  to: string;
  /** 'YYYY-MM' — the payroll month whose windows this range is judged against. */
  payMonth: string;
  onClose: () => void;
  onPickWindow: (w: PayWindow) => void;
  onViewDays: () => void;
}) {
  const isTh = useLocale() === 'th';

  // Counted from the day rows, not summed from the headline totals: a day can in principle be both
  // late and something else, and the union has to be a real count of days rather than an addition
  // that double-counts one.
  const counts = useMemo(() => {
    const leaveByType = new Map<string, number>();
    let leave = 0;
    let absent = 0;
    let late = 0;
    let lateMin = 0;
    let affected = 0;
    // totals.work_days counts days with a PUNCH, and someone on approved leave can still have
    // clocked in — so the two figures overlap. Counted here rather than left implicit: a card
    // reading "ทำงาน 5 · ลา 2" over a seven-day span is the same trap the slip fell into.
    let recordedOnLeave = 0;
    for (const d of emp.days) {
      const isLeave = !!d.leave;
      const isAbsent = !!d.absent && !isLeave;
      const isLate = (d.late_min ?? 0) > 0;
      const punched = !!d.first_in || (d.worked_min ?? 0) > 0;
      if (isLeave) {
        leave += 1;
        if (punched) recordedOnLeave += 1;
        const name = (isTh ? d.leave?.name_th : d.leave?.name_en) || (isTh ? 'ลา' : 'Leave');
        leaveByType.set(name, (leaveByType.get(name) ?? 0) + 1);
      }
      if (isAbsent) absent += 1;
      if (isLate) {
        late += 1;
        lateMin += d.late_min ?? 0;
      }
      if (isLeave || isAbsent || isLate) affected += 1;
    }
    return {
      leave,
      absent,
      late,
      lateMin,
      affected,
      recordedOnLeave,
      leaveByType: [...leaveByType.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [emp.days, isTh]);

  const windows = payWindows(payMonth);
  const current = windows.find((w) => isSameWindow(w, from, to)) ?? null;
  const others = windows.filter((w) => w !== current);

  return (
    <Modal isOpen onClose={onClose} title={emp.name} size="md">
      <div className="space-y-3">
        {/* What span these numbers cover, and what that span is */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-800/60">
          <CalendarRange className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <span className="font-medium tabular-nums text-gray-700 dark:text-gray-200">
            {dmy(from)} – {dmy(to)}
          </span>
          {current ? (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {windowTitle(current, payMonth, isTh)}
            </span>
          ) : (
            <span className="text-gray-500 dark:text-gray-400">
              {isTh ? 'ช่วงที่กำหนดเอง' : 'Custom range'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat label={isTh ? 'ขาดงาน' : 'Absent'} value={counts.absent} tone="red" />
          <Stat label={isTh ? 'ลา' : 'Leave'} value={counts.leave} tone="violet" />
          <Stat
            label={isTh ? 'มาสาย' : 'Late'}
            value={counts.late}
            tone="amber"
            hint={isTh ? `รวม ${counts.lateMin} นาที` : `${counts.lateMin} minutes in total`}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat
            label={isTh ? 'วันที่บันทึกเวลา' : 'Days recorded'}
            value={emp.totals.work_days}
            tone="emerald"
            hint={
              counts.recordedOnLeave > 0
                ? isTh
                  ? `รวมวันลาที่มาลงเวลาด้วย ${counts.recordedOnLeave} วัน`
                  : `Includes ${counts.recordedOnLeave} leave day(s) clocked anyway`
                : isTh
                  ? 'วันที่มีการลงเวลาเข้า หรือ HR บันทึกชั่วโมงให้'
                  : 'Days with an in-punch, or hours entered by HR'
            }
          />
          <Stat
            label={isTh ? 'ไม่ออกงาน' : 'No clock-out'}
            value={emp.totals.incomplete_days}
            tone="orange"
            hint={
              isTh
                ? 'ลงเวลาเข้าแต่ไม่ได้ลงออก — วันเหล่านี้คิดชั่วโมงและ OT เป็นศูนย์'
                : 'Clocked in but never out — these days compute zero hours and zero OT'
            }
          />
          <Stat
            label={isTh ? 'รวมวันที่มีเรื่อง' : 'Days flagged'}
            value={counts.affected}
            hint={
              isTh
                ? 'จำนวนวันที่ขาด ลา หรือมาสาย (นับวันละครั้ง)'
                : 'Days that were absent, on leave, or late — counted once each'
            }
          />
        </div>

        {counts.leaveByType.length > 0 && (
          <p className="text-xs text-gray-600 dark:text-gray-400">
            <span className="font-medium">{isTh ? 'แยกประเภทการลา' : 'Leave by type'}:</span>{' '}
            {counts.leaveByType.map(([name, n]) => `${name} ${n}`).join(' · ')}
            {counts.recordedOnLeave > 0 && (
              <span className="text-gray-500 dark:text-gray-500">
                {isTh
                  ? ` · ในนั้นมาลงเวลา ${counts.recordedOnLeave} วัน จึงถูกนับใน “วันที่บันทึกเวลา” ด้วย`
                  : ` · ${counts.recordedOnLeave} of these were clocked anyway, so they also sit inside “Days recorded”`}
              </span>
            )}
          </p>
        )}

        {/* The point of the card: which payroll figure this range is the one behind. */}
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          {current ? (
            <p className="text-xs leading-relaxed text-gray-700 dark:text-gray-300">
              {windowPurpose(current, payMonth, isTh)}
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {isTh
                ? 'ช่วงนี้ไม่ตรงกับช่วงที่เงินเดือนหรือ SV ใช้ ตัวเลขข้างบนจึงไม่ตรงกับสลิปใบไหนโดยตรง'
                : 'This range matches neither the salary nor an SV window, so the figures above do not correspond to any one slip.'}
            </p>
          )}
          <p className="mt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">
            {isTh ? 'ตัวเลขชุดอื่นของคนนี้นับจากช่วง:' : 'This person’s other figures are counted over:'}
          </p>
          <div className="mt-1 space-y-1">
            {others.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => onPickWindow(w)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
              >
                <span className="font-medium text-gray-700 dark:text-gray-200">
                  {windowTitle(w, payMonth, isTh)}
                </span>
                <span className="tabular-nums text-gray-500 dark:text-gray-400">
                  {dmy(w.from)} – {dmy(w.to)}
                </span>
                <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-indigo-500" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <ModalFooter>
        <Button variant="outline" onClick={onClose}>
          {isTh ? 'ปิด' : 'Close'}
        </Button>
        <Button onClick={onViewDays}>{isTh ? 'ดูรายวัน' : 'View day by day'}</Button>
      </ModalFooter>
    </Modal>
  );
}
