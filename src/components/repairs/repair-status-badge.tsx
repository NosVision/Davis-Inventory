import { Badge } from '@/components/ui';
import { REPAIR_STATUS_LABELS, REPAIR_STATUS_VARIANT } from '@/lib/repairs/status';
import type { RepairStatus } from '@/types/database';

interface RepairStatusBadgeProps {
  status: RepairStatus;
  size?: 'sm' | 'md';
}

export function RepairStatusBadge({ status, size = 'md' }: RepairStatusBadgeProps) {
  return (
    <Badge variant={REPAIR_STATUS_VARIANT[status]} size={size}>
      {REPAIR_STATUS_LABELS[status]}
    </Badge>
  );
}
