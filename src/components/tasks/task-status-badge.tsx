import { Badge } from '@/components/ui';
import { TASK_STATUS_LABELS, TASK_STATUS_VARIANT } from '@/lib/tasks/status';
import type { TaskStatus } from '@/types/tasks';

export function TaskStatusBadge({ status, size = 'md' }: { status: TaskStatus; size?: 'sm' | 'md' }) {
  return (
    <Badge variant={TASK_STATUS_VARIANT[status]} size={size}>
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}
