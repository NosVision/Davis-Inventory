'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { TaskStatusBadge } from './task-status-badge';
import { TaskDetailModal } from './task-detail-modal';
import { fmtThaiDate } from '@/lib/tasks/format';
import type { TaskWithRelations } from '@/types/tasks';

export function TabHistory({ roomId, currentUserId }: { roomId: string; currentUserId: string }) {
  const tt = useTranslations('tasks');
  const locale = useLocale();
  const [tasks, setTasks] = useState<TaskWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?roomId=${roomId}&tab=closed`);
      const data = await res.json();
      if (res.ok) setTasks(data.tasks ?? []);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>;
  }

  if (tasks.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-400">{tt('taskList.noClosedTasks')}</p>;
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
        {tasks.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => setDetailId(t.id)}
              className="flex w-full items-center gap-3 bg-white px-4 py-3 text-left hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/50"
            >
              <span className="font-mono text-xs text-gray-400">#{t.ticket_no}</span>
              <span className="flex-1 truncate text-sm text-gray-800 dark:text-gray-200">{t.title}</span>
              <span className="text-xs text-gray-400">{fmtThaiDate(t.completed_at || t.approved_at || t.updated_at, true, locale as 'th' | 'en')}</span>
              <TaskStatusBadge status={t.status} size="sm" />
            </button>
          </li>
        ))}
      </ul>
      {detailId && (
        <TaskDetailModal taskId={detailId} currentUserId={currentUserId} onClose={() => setDetailId(null)} onChanged={load} />
      )}
    </div>
  );
}
