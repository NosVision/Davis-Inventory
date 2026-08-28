'use client';

import { deriveDayStatus, STYLE } from '@/app/(dashboard)/hr/timesheet/_components/timesheet-views';
import type { DaySummary } from '@/components/hr/timesheet-parts';

/**
 * One person's period, day by day, sized to sit inside a payroll register row.
 *
 * Same glyphs and colours as the roster grid on purpose: HR should not have to learn a second
 * visual language for the same facts, and both read the same computeDaySummary the payrun does.
 */
export function PeriodStrip({
  days,
  today,
  onPickDay,
  disabled,
}: {
  days: DaySummary[];
  today: string;
  onPickDay: (businessDate: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="เวลาทำงานรายวัน">
      {days.map((d) => {
        const status = deriveDayStatus(d, today);
        const dayNum = Number(d.business_date.slice(8, 10));
        return (
          <button
            key={d.business_date}
            type="button"
            disabled={disabled}
            onClick={() => onPickDay(d.business_date)}
            title={status === 'empty' ? d.business_date : `${d.business_date} · ${STYLE[status].label}${(d.late_min ?? 0) > 0 ? ` · สาย ${d.late_min} นาที` : ''}`}
            className={`h-7 w-7 rounded text-[10px] font-medium tabular-nums transition-opacity ${
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:opacity-80'
            } ${status === 'empty' ? 'border border-dashed border-gray-300 text-gray-400 dark:border-gray-600' : STYLE[status].block}`}
          >
            {dayNum}
          </button>
        );
      })}
    </div>
  );
}
