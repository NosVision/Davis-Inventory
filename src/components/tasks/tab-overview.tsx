'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { MonthCalendar, type CalendarItem } from '@/components/maintenance/month-calendar';
import { TaskStatusBadge } from './task-status-badge';
import { TaskDetailModal } from './task-detail-modal';
import { TaskReportExport } from './task-report-export';
import { todayBangkok } from '@/lib/utils/date';
import type { TaskStatus, TaskWithRelations } from '@/types/tasks';

const TH_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const EN_MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function calStatus(s: TaskStatus): CalendarItem['status'] {
  if (s === 'done') return 'completed';
  if (s === 'cancelled' || s === 'rejected') return 'skipped';
  return 'pending';
}

function taskDate(t: TaskWithRelations): string {
  return (t.due_date || t.assigned_at || t.created_at || '').slice(0, 10);
}

interface TabOverviewProps {
  roomId: string;
  roomName: string;
  currentUserId: string;
  canExport: boolean;
  onChanged?: () => void;
}

export function TabOverview({ roomId, roomName, currentUserId, canExport, onChanged }: TabOverviewProps) {
  const t = useTranslations('tasks');
  const locale = useLocale();
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
      const res = await fetch(`/api/tasks?roomId=${roomId}`);
      const data = await res.json();
      if (res.ok) setTasks(data.tasks ?? []);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(
    () => ({
      pending: tasks.filter((t) => t.status === 'pending_approval').length,
      doing: tasks.filter((t) => t.status === 'in_progress').length,
      done: tasks.filter((t) => t.status === 'done').length,
    }),
    [tasks],
  );

  const items: CalendarItem[] = useMemo(
    () => tasks.map((t) => ({ id: t.id, due_date: taskDate(t), title: t.title, status: calStatus(t.status) })),
    [tasks],
  );

  const dayTasks = useMemo(
    () => (selectedDate ? tasks.filter((t) => taskDate(t) === selectedDate) : []),
    [tasks, selectedDate],
  );

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); } else setMonth((m) => m - 1);
    setSelectedDate(null);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); } else setMonth((m) => m + 1);
    setSelectedDate(null);
  };

  const handleChanged = () => {
    load();
    onChanged?.();
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/10">
          <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{counts.pending}</p>
          <p className="text-xs text-amber-600 dark:text-amber-500">{t('stats.kpiPendingApproval')}</p>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 dark:border-indigo-900/40 dark:bg-indigo-900/10">
          <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-400">{counts.doing}</p>
          <p className="text-xs text-indigo-600 dark:text-indigo-500">{t('status.in_progress')}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 dark:border-emerald-900/40 dark:bg-emerald-900/10">
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{counts.done}</p>
          <p className="text-xs text-emerald-600 dark:text-emerald-500">{t('status.done')}</p>
        </div>
      </div>

      {/* Calendar header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {locale === 'en' ? `${EN_MONTHS_FULL[month - 1]} ${year}` : `${TH_MONTHS_FULL[month - 1]} ${year + 543}`}
          </span>
          <button onClick={nextMonth} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><ChevronRight className="h-4 w-4" /></button>
        </div>
        {canExport && <TaskReportExport roomId={roomId} roomName={roomName} />}
      </div>

      <MonthCalendar year={year} month={month} items={items} selectedDate={selectedDate} onSelectDay={setSelectedDate} />

      {/* Day detail list */}
      {selectedDate && (
        <div className="space-y-1.5 pb-10 sm:pb-20">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('taskList.selectedDayTasks')}</p>
          {dayTasks.length === 0 ? (
            <p className="text-xs text-gray-400">{t('calendar.noTasksToday')}</p>
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

      {detailId && (
        <TaskDetailModal taskId={detailId} currentUserId={currentUserId} onClose={() => setDetailId(null)} onChanged={handleChanged} />
      )}
    </div>
  );
}
