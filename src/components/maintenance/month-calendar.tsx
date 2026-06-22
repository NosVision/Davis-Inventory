'use client';

import { cn } from '@/lib/utils/cn';

export interface CalendarItem {
  id: string;
  due_date: string; // YYYY-MM-DD
  title: string;
  status: 'pending' | 'completed' | 'skipped';
}

interface MonthCalendarProps {
  /** Full year, e.g. 2026 */
  year: number;
  /** 1-12 */
  month: number;
  items: CalendarItem[];
  /** Currently selected day (YYYY-MM-DD) */
  selectedDate: string | null;
  onSelectDay: (date: string) => void;
}

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

const DOT_COLOR: Record<CalendarItem['status'], string> = {
  pending: 'bg-amber-400',
  completed: 'bg-emerald-500',
  skipped: 'bg-gray-300 dark:bg-gray-600',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function MonthCalendar({
  year,
  month,
  items,
  selectedDate,
  onSelectDay,
}: MonthCalendarProps) {
  const startWeekday = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();

  const byDay = new Map<number, CalendarItem[]>();
  for (const it of items) {
    const d = new Date(it.due_date + 'T00:00:00');
    if (d.getFullYear() === year && d.getMonth() === month - 1) {
      const day = d.getDate();
      const arr = byDay.get(day) ?? [];
      arr.push(it);
      byDay.set(day, arr);
    }
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="grid grid-cols-7 border-b border-gray-100 dark:border-gray-800">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={cn(
              'py-2.5 text-center text-[11px] font-semibold',
              i === 0 ? 'text-rose-400' : 'text-gray-400 dark:text-gray-500',
            )}
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-gray-100 p-px dark:bg-gray-800">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} className="aspect-square bg-gray-50/60 dark:bg-gray-900/40" />;
          }
          const dayItems = byDay.get(day) ?? [];
          const dateStr = `${year}-${pad(month)}-${pad(day)}`;
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          const isSunday = i % 7 === 0;
          const hasPending = dayItems.some((it) => it.status === 'pending');

          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDay(dateStr)}
              className={cn(
                'group relative flex aspect-square flex-col items-center justify-start gap-1 bg-white p-1 transition-colors dark:bg-gray-900',
                isSelected
                  ? 'bg-cyan-500 dark:bg-cyan-500'
                  : 'hover:bg-cyan-50 dark:hover:bg-cyan-900/20',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                  isSelected
                    ? 'bg-white/25 text-white'
                    : isToday
                      ? 'bg-cyan-500 text-white'
                      : isSunday
                        ? 'text-rose-500 dark:text-rose-400'
                        : 'text-gray-700 dark:text-gray-300',
                )}
              >
                {day}
              </span>
              {dayItems.length > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-0.5">
                  {dayItems.slice(0, 3).map((it) => (
                    <span
                      key={it.id}
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        isSelected ? 'bg-white/90' : DOT_COLOR[it.status],
                      )}
                    />
                  ))}
                  {dayItems.length > 3 && (
                    <span
                      className={cn(
                        'text-[8px] font-semibold leading-none',
                        isSelected ? 'text-white' : 'text-gray-400',
                      )}
                    >
                      +{dayItems.length - 3}
                    </span>
                  )}
                </div>
              )}
              {/* subtle indicator that the day still has pending work */}
              {hasPending && !isSelected && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
