// Task Rooms (ห้องงาน / Task Management) — shared types mirroring 00051_task_rooms.sql

export type TaskStatus =
  | 'scheduled'
  | 'pending_approval'
  | 'rejected'
  | 'in_progress'
  | 'done'
  | 'cancelled';

export type TaskPriority = 'low' | 'med' | 'high';

export type TaskAssigneeState = 'pending' | 'acknowledged' | 'submitted' | 'done';

export type TaskAttachmentKind = 'image' | 'file' | 'link';

export type TaskAttachmentPhase = 'before' | 'after' | 'work';

export type TaskRoomMemberRole = 'member' | 'manager';

/** ประเภทการตอบกลับของงาน: แจ้งเพื่อทราบ / กดรับทราบ / ทำ+ส่งงาน */
export type TaskResponseType = 'notify' | 'acknowledge' | 'submit';

/** ผู้ใช้แบบย่อ สำหรับแสดง assignee / member */
export interface ProfileLite {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  role: string;
}

export interface TaskRoom {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  ticket_prefix: string;
  is_system: boolean;
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** ห้อง + ตัวเลขสรุป (สำหรับการ์ดหน้า home) */
export interface TaskRoomWithStats extends TaskRoom {
  members_count: number;
  pending: number;
  in_progress: number;
  done: number;
  is_member: boolean;
  /** ชื่อสาขา (เฉพาะเจาะจง) ที่มีงานในห้องนี้ — ใช้ตัวกรอง */
  branches: string[];
  /** มีงานข้ามสาขา (ทุกสาขา) หรือไม่ — ใช้แสดงผลบนการ์ด */
  has_all_branch: boolean;
  /** ผู้ใช้ปัจจุบันติดดาวห้องนี้ (รายการใช้บ่อย) */
  is_favorite: boolean;
}

export interface TaskRoomMember {
  id: string;
  room_id: string;
  user_id: string;
  role: TaskRoomMemberRole;
  added_by: string | null;
  joined_at: string;
  profile?: ProfileLite | null;
}

export interface TaskAssignee {
  id: string;
  task_id: string;
  user_id: string;
  state: TaskAssigneeState;
  submitted_at: string | null;
  note: string | null;
  profile?: ProfileLite | null;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  kind: TaskAttachmentKind;
  url: string;
  name: string | null;
  phase: TaskAttachmentPhase;
  uploaded_by: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  room_id: string;
  ticket_no: string;
  store_id: string | null;
  category: string | null;
  title: string;
  detail: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  requires_approval: boolean;
  approver_ids: string[];
  require_attachment: boolean;
  response_type: TaskResponseType;
  assigner_id: string | null;
  assigned_at: string;
  start_date: string | null;
  due_date: string | null;
  is_recurring_instance: boolean;
  recurrence_id: string | null;
  occurrence_date: string | null;
  approval_status: 'pending' | 'approved' | 'rejected' | null;
  approved_by: string | null;
  approved_at: string | null;
  owner_note: string | null;
  completed_by: string | null;
  completed_at: string | null;
  estimated_cost: number | null;
  meta: Record<string, unknown> | null;
  is_pinned: boolean;
  pinned_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** งาน + ข้อมูลที่ join มาแสดงในรายละเอียด */
export interface TaskWithRelations extends Task {
  assignees: TaskAssignee[];
  attachments: TaskAttachment[];
  assigner?: ProfileLite | null;
  store_name?: string | null;
  /** true ถ้าผู้ใช้ปัจจุบันเป็นผู้รับผิดชอบงานนี้ ("ของฉัน") */
  is_mine?: boolean;
}

/** Input สำหรับสร้าง/แก้ไขไฟล์แนบ (ส่งจากฟอร์ม) */
export interface TaskAttachmentInput {
  kind: TaskAttachmentKind;
  url: string;
  name?: string | null;
}

export type TaskRecurrenceKind = 'once' | 'day_of_month' | 'every_weeks' | 'every_months';

export interface TaskRecurrence {
  id: string;
  room_id: string;
  store_id: string | null;
  title: string;
  detail: string | null;
  category: string | null;
  priority: TaskPriority;
  requires_approval: boolean;
  require_attachment: boolean;
  response_type: TaskResponseType;
  approver_ids: string[];
  default_assignee_ids: string[];
  attachments: TaskAttachmentInput[];
  kind: TaskRecurrenceKind;
  start_date: string;
  day_of_month: number | null;
  interval_count: number;
  remind_every_days: number | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
