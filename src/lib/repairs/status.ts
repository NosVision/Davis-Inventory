import type {
  RepairStatus,
  RepairResolution,
  RepairPriority,
} from '@/types/database';

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'outline';

export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  pending: 'รอช่างรับงาน',
  in_progress: 'กำลังดำเนินการ',
  awaiting_approval: 'รออนุมัติสั่งซื้อ',
  approved: 'อนุมัติแล้ว (รอซ่อม)',
  rejected: 'ไม่อนุมัติ',
  completed: 'ซ่อมเสร็จแล้ว',
  cancelled: 'ยกเลิก',
};

export const REPAIR_STATUS_VARIANT: Record<RepairStatus, BadgeVariant> = {
  pending: 'warning',
  in_progress: 'info',
  awaiting_approval: 'warning',
  approved: 'info',
  rejected: 'danger',
  completed: 'success',
  cancelled: 'default',
};

export const REPAIR_RESOLUTION_LABELS: Record<RepairResolution, string> = {
  repairable: 'ซ่อมได้',
  needs_purchase: 'ต้องสั่งซื้อ',
};

export const REPAIR_PRIORITY_LABELS: Record<RepairPriority, string> = {
  normal: 'ปกติ',
  urgent: 'เร่งด่วน',
};

/** สถานะที่ยังไม่ปิดงาน (ค้าง) */
export const OPEN_REPAIR_STATUSES: RepairStatus[] = [
  'pending',
  'in_progress',
  'awaiting_approval',
  'approved',
];

/** สถานะที่ปิดงานแล้ว */
export const CLOSED_REPAIR_STATUSES: RepairStatus[] = [
  'completed',
  'rejected',
  'cancelled',
];

export function isOpenRepair(status: RepairStatus): boolean {
  return OPEN_REPAIR_STATUSES.includes(status);
}
