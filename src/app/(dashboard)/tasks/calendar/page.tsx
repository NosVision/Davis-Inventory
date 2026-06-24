'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { MonthCalendar, type CalendarItem } from '@/components/maintenance/month-calendar';
import { TaskStatusBadge } from '@/components/tasks/task-status-badge';
import { TaskDetailModal } from '@/components/tasks/task-detail-modal';
import { useAuthStore } from '@/stores/auth-store';
import { todayBangkok } from '@/lib/utils/date';
import type { TaskStatus, TaskWithRelations } from '@/types/tasks';

const TH_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function calStatus(s: TaskStatus): CalendarItem['status'] {
  if (s === 'done') return 'completed';
  if (s === 'cancelled' || s === 'rejected') return 'skipped';
  return 'pending';
}
function taskDate(t: TaskWithRelations): string {
  return (t.due_date || t.assigned_at || t.created_at || '').slice(0, 10);
}

export default function MyCalendarPage() {
  const { user } = useAuthStore();
  const [tasks, setTasks] = useState<TaskWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(todayBangkok());
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tasks?mine=1');
      const data = await res.json();
      if (res.ok) setTasks(data.tasks ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items: CalendarItem[] = useMemo(
    () => tasks.map((t) => ({ id: t.id, due_date: taskDate(t), title: t.title, status: calStatus(t.status) })),
    [tasks],
  );
  const dayTasks = useMemo(
    () => (selectedDate ? tasks.filter((t) => taskDate(t) === selectedDate) : []),
    [tasks, selectedDate],
  );

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear((y) => y - 1); } else setMonth((m) => m - 1); setSelectedDate(null); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear((y) => y + 1); } else setMonth((m) => m + 1); setSelectedDate(null); };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link href="/tasks" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">ปฏิทินงานของฉัน</h1>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={prevMonth} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{TH_MONTHS_FULL[month - 1]} {year + 543}</span>
        <button onClick={nextMonth} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><ChevronRight className="h-4 w-4" /></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
      ) : (
        <>
          <MonthCalendar year={year} month={month} items={items} selectedDate={selectedDate} onSelectDay={setSelectedDate} />
          {selectedDate && (
            <div className="space-y-1.5 pb-10 sm:pb-20">
              {dayTasks.length === 0 ? (
                <p className="text-xs text-gray-400">ไม่มีงานในวันนี้</p>
              ) : (
                dayTasks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setDetailId(t.id)}
                    className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50"
                  >
                    <span className="font-mono text-xs text-gray-400">#{t.ticket_no}</span>
                    <span className="flex-1 truncate text-gray-800 dark:text-gray-200">{t.title}</span>
                    <TaskStatusBadge status={t.status} size="sm" />
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}

      {detailId && user && (
        <TaskDetailModal taskId={detailId} currentUserId={user.id} onClose={() => setDetailId(null)} onChanged={load} />
      )}
    </div>
  );
}
