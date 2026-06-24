import type {
  TaskStatus,
  TaskPriority,
  TaskAssigneeState,
  TaskResponseType,
} from '@/types/tasks';

export const TASK_RESPONSE_TYPE_LABELS: Record<TaskResponseType, string> = {
  notify: 'แจ้งเพื่อทราบ',
  acknowledge: 'ให้กดรับทราบ',
  submit: 'ทำ + ส่งงาน',
};

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'outline';

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  scheduled: 'รอเริ่ม',
  pending_approval: 'รออนุมัติ',
  in_progress: 'กำลังดำเนินการ',
  done: 'เสร็จสิ้น',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
};

export const TASK_STATUS_VARIANT: Record<TaskStatus, BadgeVariant> = {
  scheduled: 'outline',
  pending_approval: 'warning',
  in_progress: 'info',
  done: 'success',
  rejected: 'danger',
  cancelled: 'default',
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'ต่ำ',
  med: 'กลาง',
  high: 'สูง',
};

/** สีจุดความสำคัญ (ตรงกับ mockup PRI) */
export const TASK_PRIORITY_DOT: Record<TaskPriority, string> = {
  low: '#94a3b8',
  med: '#f59e0b',
  high: '#ef4444',
};

export const TASK_ASSIGNEE_STATE_LABELS: Record<TaskAssigneeState, string> = {
  pending: 'รอเริ่ม',
  acknowledged: 'รับทราบแล้ว',
  submitted: 'ส่งงานแล้ว',
  done: 'เสร็จแล้ว',
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
