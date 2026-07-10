import type { UserRole, Permission } from '@/types/roles';
import type { AuthUser } from '@/lib/auth/permissions';

export interface ModuleConfig {
  id: string;
  nameKey: string;
  descriptionKey: string;
  icon: string;
  color: string; // tailwind color name
  href: string;
  roles: UserRole[];
  permission?: Permission;
  badge?: 'pending_count' | 'my_tasks_count' | 'hr_pending_count';
  groupKey: string;
}

// Baseline modules every dashboard role can reach (owner ask 2026-07-08): the task hub, chat,
// the personal self-service home, and the guide. `customer` is excluded (separate /customer portal).
const ALL_STAFF: UserRole[] = [
  'owner',
  'accountant',
  'manager',
  'bar',
  'head_bar',
  'staff',
  'hq',
  'technician',
  'hr',
  'cashier',
  'housekeeping_staff',
  'boh_staff',
  // ยังไม่ระบุ (self-registered, pending HR) — baseline only: chat / me / task rooms.
  'unspecified',
];

export const modules: ModuleConfig[] = [
  // ─── หลัก ───
  {
    id: 'overview',
    nameKey: 'modules.overview.name',
    descriptionKey: 'modules.overview.description',
    icon: 'layout-dashboard',
    color: 'violet',
    href: '/overview',
    roles: ['owner'],
    groupKey: 'moduleGroups.main',
  },
  {
    id: 'chat',
    nameKey: 'modules.chat.name',
    descriptionKey: 'modules.chat.description',
    icon: 'message-circle',
    color: 'blue',
    href: '/chat',
    roles: ALL_STAFF,
    groupKey: 'moduleGroups.main',
  },
  {
    // งานบุคคลของฉัน (ESS home) — เข้าถึงได้ทุก role: เช็คอิน/ตาราง/ลา/สลิป/ประเมิน
    id: 'me',
    nameKey: 'modules.me.name',
    descriptionKey: 'modules.me.description',
    icon: 'user-circle',
    color: 'teal',
    href: '/me',
    roles: ALL_STAFF,
    groupKey: 'moduleGroups.main',
  },
  {
    // ห้องงาน (Task Management) — baseline ทุก role; การมองเห็นจริงคุมที่ membership/RLS ในหน้า
    id: 'tasks',
    nameKey: 'modules.tasks.name',
    descriptionKey: 'modules.tasks.description',
    icon: 'clipboard-list',
    color: 'indigo',
    href: '/tasks',
    roles: ALL_STAFF,
    badge: 'my_tasks_count',
    groupKey: 'moduleGroups.main',
  },

  // ─── คลังสินค้า (Inventory) — คลังกลางบนสุด, ตามด้วยกล่องอนุมัติ, แล้วงานคลังรายสาขา ───
  {
    id: 'hq-warehouse',
    nameKey: 'modules.hqWarehouse.name',
    descriptionKey: 'modules.hqWarehouse.description',
    icon: 'warehouse',
    color: 'teal',
    href: '/hq-warehouse',
    roles: ['owner', 'hq'],
    permission: 'can_transfer',
    groupKey: 'moduleGroups.warehouse',
  },
  {
    id: 'inbox',
    nameKey: 'modules.inbox.name',
    descriptionKey: 'modules.inbox.description',
    icon: 'inbox',
    color: 'fuchsia',
    href: '/inbox',
    // Approvals hub — owner + HQ (HQ = all approval surfaces, owner ask 2026-07-08).
    // จัดกลุ่มไว้ที่ "คลังสินค้า" (owner ask 2026-07-08).
    roles: ['owner', 'hq'],
    badge: 'pending_count',
    groupKey: 'moduleGroups.warehouse',
  },
  {
    id: 'stock',
    nameKey: 'modules.stock.name',
    descriptionKey: 'modules.stock.description',
    icon: 'clipboard-check',
    color: 'indigo',
    href: '/stock',
    roles: ['owner', 'bar', 'head_bar', 'hq'],
    permission: 'can_count_stock',
    groupKey: 'moduleGroups.warehouse',
  },
  {
    id: 'deposit',
    nameKey: 'modules.deposit.name',
    descriptionKey: 'modules.deposit.description',
    icon: 'wine',
    color: 'emerald',
    href: '/deposit',
    // Alcohol Deposit — owner, manager (ฝาก/เบิกด้วย), bar + staff (คงเดิม), hq.
    roles: ['owner', 'manager', 'bar', 'head_bar', 'staff', 'hq'],
    permission: 'can_manage_deposit',
    groupKey: 'moduleGroups.warehouse',
  },
  {
    id: 'transfer',
    nameKey: 'modules.transfer.name',
    descriptionKey: 'modules.transfer.description',
    icon: 'arrow-left-right',
    color: 'blue',
    href: '/transfer',
    roles: ['owner', 'bar', 'head_bar', 'hq'],
    permission: 'can_transfer',
    groupKey: 'moduleGroups.warehouse',
  },
  {
    id: 'borrow',
    nameKey: 'modules.borrow.name',
    descriptionKey: 'modules.borrow.description',
    icon: 'shuffle',
    color: 'rose',
    href: '/borrow',
    roles: ['owner', 'bar', 'head_bar', 'hq'],
    permission: 'can_borrow',
    groupKey: 'moduleGroups.warehouse',
  },
  {
    // HQ management of the stock-penalty / SOP system (owner ask 2026-07-09): weekly + monthly
    // summary, Auto/Manual send-to-HR toggle, and ad-hoc SV deductions.
    id: 'stock-penalties',
    nameKey: 'modules.stockPenalties.name',
    descriptionKey: 'modules.stockPenalties.description',
    icon: 'scale',
    color: 'rose',
    href: '/stock/penalties',
    roles: ['owner', 'hq'],
    permission: 'can_manage_stock_sop',
    groupKey: 'moduleGroups.warehouse',
  },

  // ─── บัญชี (Accounting) — คอมมิชชั่น/AE ───
  {
    id: 'commission',
    nameKey: 'modules.commission.name',
    descriptionKey: 'modules.commission.description',
    icon: 'hand-coins',
    color: 'amber',
    href: '/commission',
    // AE — owner, accountant, cashier.
    roles: ['owner', 'accountant', 'cashier'],
    permission: 'can_manage_commission',
    groupKey: 'moduleGroups.accounting',
  },

  // ─── งานซ่อมบำรุง (ซ่อนเมนูชั่วคราว — โค้ด/หน้า/DB ยังอยู่ครบ; ลบคอมเมนต์เพื่อเปิดคืน) ───
  /*
  {
    id: 'repair-new',
    nameKey: 'modules.repairNew.name',
    descriptionKey: 'modules.repairNew.description',
    icon: 'wrench',
    color: 'orange',
    href: '/repairs/new',
    roles: ['owner', 'manager', 'bar', 'staff'],
    permission: 'can_request_repair',
    groupKey: 'moduleGroups.maintenance',
  },
  {
    id: 'repairs',
    nameKey: 'modules.repairs.name',
    descriptionKey: 'modules.repairs.description',
    icon: 'clipboard-list',
    color: 'rose',
    href: '/repairs',
    roles: ['owner', 'accountant', 'manager', 'technician'],
    permission: 'can_manage_repair',
    groupKey: 'moduleGroups.maintenance',
  },
  {
    id: 'maintenance',
    nameKey: 'modules.maintenance.name',
    descriptionKey: 'modules.maintenance.description',
    icon: 'calendar-days',
    color: 'cyan',
    href: '/maintenance',
    roles: ['owner', 'technician'],
    groupKey: 'moduleGroups.maintenance',
  },
  {
    id: 'maintenance-schedules',
    nameKey: 'modules.maintenanceSchedules.name',
    descriptionKey: 'modules.maintenanceSchedules.description',
    icon: 'repeat',
    color: 'teal',
    href: '/maintenance/schedules',
    roles: ['owner'],
    groupKey: 'moduleGroups.maintenance',
  },
  */

  // ─── HR (บุคคล) — owner + hr (โมเดลใหม่: hr เห็นเฉพาะ HR + baseline) ───
  {
    id: 'hr',
    nameKey: 'modules.hr.name',
    descriptionKey: 'modules.hr.description',
    icon: 'user-cog',
    color: 'teal',
    href: '/hr',
    roles: ['owner', 'hr'],
    permission: 'can_manage_hr',
    badge: 'hr_pending_count',
    groupKey: 'moduleGroups.hr',
  },

  // ─── รายงาน ───
  {
    id: 'reports',
    nameKey: 'modules.reports.name',
    descriptionKey: 'modules.reports.description',
    icon: 'file-bar-chart',
    color: 'amber',
    href: '/reports',
    roles: ['owner'],
    permission: 'can_view_reports',
    groupKey: 'moduleGroups.reports',
  },
  {
    id: 'activity',
    nameKey: 'modules.activity.name',
    descriptionKey: 'modules.activity.description',
    icon: 'shield-check',
    color: 'cyan',
    href: '/activity',
    roles: ['owner'],
    permission: 'can_manage_settings',
    groupKey: 'moduleGroups.reports',
  },

  // ─── วิเคราะห์ ───
  {
    id: 'performance-staff',
    nameKey: 'modules.performanceStaff.name',
    descriptionKey: 'modules.performanceStaff.description',
    icon: 'trophy',
    color: 'amber',
    href: '/performance/staff',
    roles: ['owner'],
    permission: 'can_view_reports',
    groupKey: 'moduleGroups.analytics',
  },
  {
    id: 'performance-stores',
    nameKey: 'modules.performanceStores.name',
    descriptionKey: 'modules.performanceStores.description',
    icon: 'scale',
    color: 'indigo',
    href: '/performance/stores',
    roles: ['owner'],
    permission: 'can_view_reports',
    groupKey: 'moduleGroups.analytics',
  },
  {
    id: 'performance-operations',
    nameKey: 'modules.performanceOperations.name',
    descriptionKey: 'modules.performanceOperations.description',
    icon: 'zap',
    color: 'rose',
    href: '/performance/operations',
    roles: ['owner'],
    permission: 'can_view_reports',
    groupKey: 'moduleGroups.analytics',
  },
  {
    id: 'performance-customers',
    nameKey: 'modules.performanceCustomers.name',
    descriptionKey: 'modules.performanceCustomers.description',
    icon: 'pie-chart',
    color: 'emerald',
    href: '/performance/customers',
    roles: ['owner'],
    permission: 'can_view_reports',
    groupKey: 'moduleGroups.analytics',
  },

  // ─── ช่วยเหลือ ───
  {
    id: 'guide',
    nameKey: 'modules.guide.name',
    descriptionKey: 'modules.guide.description',
    icon: 'book-open',
    color: 'sky',
    href: '/guide',
    roles: ALL_STAFF,
    groupKey: 'moduleGroups.help',
  },

  // ─── ระบบ ───
  {
    id: 'announcements',
    nameKey: 'modules.announcements.name',
    descriptionKey: 'modules.announcements.description',
    icon: 'megaphone',
    color: 'pink',
    href: '/announcements',
    roles: ['owner'],
    permission: 'can_manage_settings',
    groupKey: 'moduleGroups.system',
  },
  {
    id: 'users',
    nameKey: 'modules.users.name',
    descriptionKey: 'modules.users.description',
    icon: 'user-cog',
    color: 'orange',
    href: '/users',
    // Owner + HR only (owner ask 2026-07-08). Also surfaced as a tile on the HR hub.
    roles: ['owner', 'hr'],
    permission: 'can_manage_hr',
    groupKey: 'moduleGroups.system',
  },
  {
    id: 'settings',
    nameKey: 'modules.settings.name',
    descriptionKey: 'modules.settings.description',
    icon: 'settings',
    color: 'gray',
    href: '/settings',
    roles: ['owner'],
    permission: 'can_manage_settings',
    groupKey: 'moduleGroups.system',
  },
];

export function getModulesForRole(role: UserRole): ModuleConfig[] {
  return modules.filter((m) => m.roles.includes(role));
}

/**
 * คืนโมดูลทั้งหมดที่ผู้ใช้คนนี้เข้าถึงได้ โดยรวม:
 * 1. Role-based access: ถ้า user.role อยู่ใน module.roles
 * 2. Individual permission override: ถ้า module.permission ถูกประกาศไว้
 *    และผู้ใช้ได้รับ permission นั้นแบบรายบุคคล (user.permissions)
 *
 * Owner (role มี '*' wildcard) เห็นทุกโมดูลอยู่แล้วผ่าน role check
 */
export function getAccessibleModules(user: AuthUser): ModuleConfig[] {
  return modules.filter((m) => {
    // 1) role-based access
    if (m.roles.includes(user.role)) return true;
    // 2) individual permission unlock — ต้องประกาศ permission ไว้
    if (m.permission && user.permissions.includes(m.permission)) return true;
    return false;
  });
}
