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
  onSelect: (item: CalendarItem) => void;
}

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

const STATUS_CHIP: Record<CalendarItem['status'], string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  skipped: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

export function MonthCalendar({ year, month, items, onSelect }: MonthCalendarProps) {
  const firstDay = new Date(year, month - 1, 1);
  const startWeekday = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();

  // Group items by day-of-month
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

  const todayStr = new Date().toDateString();

  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-gray-200 dark:ring-gray-700">
      <div className="grid grid-cols-7 bg-gray-50 dark:bg-gray-800/50">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="py-2 text-center text-[11px] font-semibold text-gray-500 dark:text-gray-400"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (day === null) {
            return (
              <div
                key={`empty-${i}`}
                className="min-h-[72px] border-b border-r border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/30"
              />
            );
          }
          const dayItems = byDay.get(day) ?? [];
          const isToday =
            new Date(year, month - 1, day).toDateString() === todayStr;
          return (
            <div
              key={day}
              className="min-h-[72px] border-b border-r border-gray-100 p-1 dark:border-gray-800"
            >
              <div
                className={cn(
                  'mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px]',
                  isToday
                    ? 'bg-indigo-600 font-bold text-white'
                    : 'text-gray-500 dark:text-gray-400',
                )}
              >
                {day}
              </div>
              <div className="space-y-0.5">
                {dayItems.slice(0, 3).map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => onSelect(it)}
                    className={cn(
                      'block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium',
                      STATUS_CHIP[it.status],
                    )}
                    title={it.title}
                  >
                    {it.title}
                  </button>
                ))}
                {dayItems.length > 3 && (
                  <span className="block px-1 text-[10px] text-gray-400">
                    +{dayItems.length - 3}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
