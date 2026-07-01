'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui';
import { TASK_STATUS_VARIANT } from '@/lib/tasks/status';
import type { TaskStatus } from '@/types/tasks';

export function TaskStatusBadge({ status, size = 'md' }: { status: TaskStatus; size?: 'sm' | 'md' }) {
  const t = useTranslations('tasks.status');
  return (
    <Badge variant={TASK_STATUS_VARIANT[status]} size={size}>
      {t(status)}
    </Badge>
  );
}
