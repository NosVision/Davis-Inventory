'use client';

import { useTranslations } from 'next-intl';
import { TASK_PRIORITY_DOT } from '@/lib/tasks/status';
import type { TaskPriority } from '@/types/tasks';

export function TaskPriorityDot({
  priority,
  showLabel = true,
}: {
  priority: TaskPriority;
  showLabel?: boolean;
}) {
  const t = useTranslations('tasks.priority');
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: TASK_PRIORITY_DOT[priority] }}
      />
      {showLabel && t(priority)}
    </span>
  );
}
