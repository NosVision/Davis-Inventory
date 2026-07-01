import type {
  TaskStatus,
  TaskPriority,
} from '@/types/tasks';

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'outline';

export const TASK_STATUS_VARIANT: Record<TaskStatus, BadgeVariant> = {
  scheduled: 'outline',
  pending_approval: 'warning',
  in_progress: 'info',
  done: 'success',
  rejected: 'danger',
  cancelled: 'default',
};

/** สีจุดความสำคัญ (ตรงกับ mockup PRI) */
export const TASK_PRIORITY_DOT: Record<TaskPriority, string> = {
  low: '#94a3b8',
  med: '#f59e0b',
  high: '#ef4444',
};

/** สถานะที่ยังไม่ปิดงาน + ถึงวันเริ่มแล้ว (ค้าง) */
export const OPEN_TASK_STATUSES: TaskStatus[] = ['pending_approval', 'in_progress'];

/** งานที่ยังไม่ถึงวันเริ่ม (ล่วงหน้า) */
export const UPCOMING_TASK_STATUSES: TaskStatus[] = ['scheduled'];

/** สถานะที่ปิดงานแล้ว */
export const CLOSED_TASK_STATUSES: TaskStatus[] = ['done', 'rejected', 'cancelled'];

export function isOpenTask(status: TaskStatus): boolean {
  return OPEN_TASK_STATUSES.includes(status);
}
