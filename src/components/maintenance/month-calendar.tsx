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

const CHIP: Record<CalendarItem['status'], string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  skipped: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
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
              'py-2 text-center text-[11px] font-semibold',
              i === 0 ? 'text-rose-400' : 'text-gray-400 dark:text-gray-500',
            )}
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-gray-100 dark:bg-gray-800">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} className="min-h-[72px] bg-gray-50/60 dark:bg-gray-900/40" />;
          }
          const dayItems = byDay.get(day) ?? [];
          const dateStr = `${year}-${pad(month)}-${pad(day)}`;
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          const isSunday = i % 7 === 0;

          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDay(dateStr)}
              className={cn(
                'flex min-h-[72px] flex-col gap-0.5 p-1 text-left align-top transition-colors sm:min-h-[88px]',
                isSelected
                  ? 'bg-cyan-500'
                  : 'bg-white hover:bg-cyan-50 dark:bg-gray-900 dark:hover:bg-cyan-900/20',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
                  isSelected
                    ? 'bg-white/25 text-white'
                    : isToday
                      ? 'bg-cyan-500 text-white'
                      : isSunday
                        ? 'text-rose-500 dark:text-rose-400'
                        : 'text-gray-600 dark:text-gray-300',
                )}
              >
                {day}
              </span>

              <div className="flex w-full flex-col gap-0.5 overflow-hidden">
                {dayItems.slice(0, 2).map((it) => (
                  <span
                    key={it.id}
                    title={it.title}
                    className={cn(
                      'truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight',
                      isSelected ? 'bg-white/20 text-white' : CHIP[it.status],
                    )}
                  >
                    {it.title}
                  </span>
                ))}
                {dayItems.length > 2 && (
                  <span
                    className={cn(
                      'px-1 text-[9px] font-medium leading-tight',
                      isSelected ? 'text-white/90' : 'text-gray-400',
                    )}
                  >
                    +{dayItems.length - 2} เพิ่มเติม
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
