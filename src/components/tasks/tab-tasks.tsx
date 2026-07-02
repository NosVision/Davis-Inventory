'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Search, Loader2, Pin } from 'lucide-react';
import { Tabs, Input } from '@/components/ui';
import { TaskStatusBadge } from './task-status-badge';
import { TaskPriorityDot } from './task-priority-dot';
import { TaskDetailModal } from './task-detail-modal';
import { initial, avatarColor, fmtThaiDate } from '@/lib/tasks/format';
import { OPEN_TASK_STATUSES, CLOSED_TASK_STATUSES, UPCOMING_TASK_STATUSES } from '@/lib/tasks/status';
import type { TaskWithRelations } from '@/types/tasks';

interface TabTasksProps {
  roomId: string;
  currentUserId: string;
  /** bump ค่านี้จากหน้าแม่เพื่อสั่งโหลดรายการใหม่ (เช่น หลังสร้างงานจากปุ่มบนหัว) */
  refreshKey?: number;
  onTasksChanged?: () => void;
}

type FilterKey = 'open' | 'upcoming' | 'closed' | 'all';

export function TabTasks({ roomId, currentUserId, refreshKey = 0, onTasksChanged }: TabTasksProps) {
  const tt = useTranslations('tasks');
  const locale = useLocale();
  const [tasks, setTasks] = useState<TaskWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('open');
  const [search, setSearch] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
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
  }, [load, refreshKey]);

  const counts = useMemo(
    () => ({
      open: tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status)).length,
      upcoming: tasks.filter((t) => UPCOMING_TASK_STATUSES.includes(t.status)).length,
      closed: tasks.filter((t) => CLOSED_TASK_STATUSES.includes(t.status)).length,
      all: tasks.length,
    }),
    [tasks],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tasks.filter((t) => {
      if (filter === 'open' && !OPEN_TASK_STATUSES.includes(t.status)) return false;
      if (filter === 'upcoming' && !UPCOMING_TASK_STATUSES.includes(t.status)) return false;
      if (filter === 'closed' && !CLOSED_TASK_STATUSES.includes(t.status)) return false;
      if (mineOnly && !t.is_mine) return false;
      if (q && !`${t.ticket_no} ${t.title} ${t.detail ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // งานปักหมุดขึ้นก่อน แล้วตามด้วยงานที่รอผู้ใช้คนนี้รับ (claim)
    return list.sort(
      (a, b) => Number(b.is_pinned) - Number(a.is_pinned) || Number(b.can_claim) - Number(a.can_claim),
    );
  }, [tasks, filter, search, mineOnly]);

  const handleChanged = () => {
    load();
    onTasksChanged?.();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { id: 'open', label: tt('taskList.filterOpen'), count: counts.open },
            { id: 'upcoming', label: tt('taskList.filterUpcoming'), count: counts.upcoming },
            { id: 'closed', label: tt('taskList.filterClosed'), count: counts.closed },
            { id: 'all', label: tt('taskList.filterAll'), count: counts.all },
          ]}
          activeTab={filter}
          onChange={(t) => setFilter(t as FilterKey)}
        />
        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} className="h-4 w-4 rounded" />
          {tt('taskList.mine')}
        </label>
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={tt('taskList.searchPlaceholder')}
        leftIcon={<Search className="h-4 w-4" />}
      />

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">{tt('taskList.emptyView')}</p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {filtered.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setDetailId(t.id)}
                className="flex w-full items-center gap-3 bg-white px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {t.is_pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                    <span className="font-mono text-xs text-gray-400">#{t.ticket_no}</span>
                    <TaskPriorityDot priority={t.priority} showLabel={false} />
                    {t.is_mine && (
                      <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                        {tt('taskList.mine')}
                      </span>
                    )}
                    {t.can_claim && (
                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        🔔 {tt('taskList.waitingForMe')}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-medium text-gray-900 dark:text-white">{t.title}</p>
                  <p className="text-xs text-gray-400">
                    {t.category ? `${t.category} · ` : ''}
                    {t.due_date ? tt('taskList.due', { date: fmtThaiDate(t.due_date, true, locale as 'th' | 'en') }) : tt('taskList.assigned', { date: fmtThaiDate(t.assigned_at, true, locale as 'th' | 'en') })}
                    {(t.assignees?.length ?? 0) > 1 &&
                      ` · ${t.response_type === 'submit' ? tt('taskList.submitted') : tt('taskList.acknowledged')} ${
                        (t.assignees ?? []).filter((a) => a.state === 'submitted' || a.state === 'done').length
                      }/${t.assignees?.length ?? 0}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex -space-x-2">
                    {(t.assignees ?? []).slice(0, 3).map((a) => {
                      const name = a.profile?.display_name || a.profile?.username || tt('detail.defaultUser');
                      return (
                        <span
                          key={a.id}
                          title={name}
                          className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white dark:border-gray-800"
                          style={{ backgroundColor: avatarColor(a.user_id) }}
                        >
                          {initial(name)}
                        </span>
                      );
                    })}
                  </div>
                  <TaskStatusBadge status={t.status} size="sm" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {detailId && (
        <TaskDetailModal
          taskId={detailId}
          currentUserId={currentUserId}
          onClose={() => setDetailId(null)}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
