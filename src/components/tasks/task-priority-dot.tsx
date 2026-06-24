import { TASK_PRIORITY_DOT, TASK_PRIORITY_LABELS } from '@/lib/tasks/status';
import type { TaskPriority } from '@/types/tasks';

export function TaskPriorityDot({
  priority,
  showLabel = true,
}: {
  priority: TaskPriority;
  showLabel?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: TASK_PRIORITY_DOT[priority] }}
      />
      {showLabel && TASK_PRIORITY_LABELS[priority]}
    </span>
  );
}
