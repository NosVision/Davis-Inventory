export type UserRole =
  | 'owner'
  | 'accountant'
  | 'manager'
  | 'bar'
  | 'head_bar'
  | 'technician'
  | 'staff'
  | 'customer'
  | 'hq'
  | 'hr'
  | 'cashier'
  | 'housekeeping_staff'
  | 'boh_staff'
  // Default for self-registered employees until HR assigns a real role. No permissions;
  // sees only the baseline menus (chat / me / task rooms).
  | 'unspecified';

export type Permission =
  | 'can_count_stock'
  | 'can_manage_deposit'
  | 'can_approve_deposit'
  | 'can_approve_stock'
  | 'can_manage_users'
  | 'can_view_reports'
  | 'can_manage_settings'
  | 'can_transfer'
  | 'can_view_own_deposits'
  | 'can_request_withdrawal'
  | 'can_borrow'
  | 'can_manage_commission'
  | 'can_request_repair'
  | 'can_manage_repair'
  | 'can_manage_hr'
  | 'can_manage_stock_sop';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[] | ['*']> = {
  owner: ['*'],
  // Account = ใช้ได้หมดเลย ดูข้ามสาขา
  accountant: ['*'],
  // Manager = คนคุมร้าน ดูได้เฉพาะในสาขา ทุกเมนู
  manager: [
    'can_count_stock',
    'can_approve_stock',
    'can_manage_deposit',
    'can_approve_deposit',
    'can_transfer',
    'can_borrow',
    'can_view_reports',
    'can_manage_commission',
    'can_request_repair',
    'can_manage_repair',
  ],
  // Bar = นับสต๊อค เช็คสต๊อค ฝากเหล้า ยืม เบิกเหล้า โอนคลังกลางที่หมดอายุ แชท
  bar: [
    'can_count_stock',
    'can_approve_stock',
    'can_manage_deposit',
    'can_approve_deposit',
    'can_borrow',
    'can_transfer',
    'can_request_repair',
  ],
  // Head Bar = สิทธิ์การเข้าถึงเหมือน bar ทุกอย่าง (owner ask 2026-07-09) — เป็นตำแหน่งหัวหน้าบาร์
  head_bar: [
    'can_count_stock',
    'can_approve_stock',
    'can_manage_deposit',
    'can_approve_deposit',
    'can_borrow',
    'can_transfer',
    'can_request_repair',
  ],
  // Technician → ช่างซ่อมบำรุง (Maintenance): งานประจำ (Task) + แจ้ง/รับงานซ่อม
  technician: ['can_manage_repair', 'can_request_repair'],
  // Staff = ฝากเหล้า / เบิกเหล้า / แชท / แจ้งซ่อม
  staff: ['can_manage_deposit', 'can_request_repair'],
  customer: ['can_view_own_deposits', 'can_request_withdrawal'],
  hq: ['can_transfer', 'can_view_reports', 'can_manage_stock_sop'],
  // HR = ฝ่ายบุคคล: HR + จัดการผู้ใช้ (โมเดลใหม่ 2026-07-08 — แคบลง เหลือ HR + baseline)
  hr: ['can_manage_hr', 'can_manage_users'],
  // Cashier = AE (คอมมิชชั่น) + งานประจำ
  cashier: ['can_manage_commission'],
  // House Keeping = งานประจำ (Task) เท่านั้น
  housekeeping_staff: [],
  // BOH (หลังร้าน) = งานประจำ (Task) เท่านั้น
  boh_staff: [],
  // ยังไม่ระบุ = ไม่มีสิทธิ์ใดๆ เห็นแค่ chat/me/tasks รอ HR กำหนดสิทธิ์
  unspecified: [],
};

// Position labels are shown in ENGLISH always (owner ask 2026-07-09), regardless of app locale.
export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  accountant: 'Accountant',
  manager: 'Manager',
  bar: 'Bar',
  head_bar: 'Head Bar',
  technician: 'Maintenance',
  staff: 'Staff',
  customer: 'Customer',
  hq: 'HQ Warehouse',
  hr: 'HR',
  cashier: 'Cashier',
  housekeeping_staff: 'Housekeeping',
  boh_staff: 'BOH Staff',
  unspecified: 'Unspecified',
};

/** Translation keys for role labels — use with useTranslations() */
export const ROLE_LABEL_KEYS: Record<UserRole, string> = {
  owner: 'roles.owner',
  accountant: 'roles.accountant',
  manager: 'roles.manager',
  bar: 'roles.bar',
  head_bar: 'roles.head_bar',
  technician: 'roles.technician',
  staff: 'roles.staff',
  customer: 'roles.customer',
  hq: 'roles.hq',
  hr: 'roles.hr',
  cashier: 'roles.cashier',
  housekeeping_staff: 'roles.housekeeping_staff',
  boh_staff: 'roles.boh_staff',
  unspecified: 'roles.unspecified',
};

export const ROLE_HOME_ROUTES: Record<UserRole, string> = {
  owner: '/overview',
  // accountant + cashier home on their AE (commission) surface
  accountant: '/commission',
  // manager no longer lands on store-overview (removed from their menu) — the shared Task hub
  manager: '/tasks',
  bar: '/me',
  head_bar: '/me',
  technician: '/tasks',
  staff: '/me',
  customer: '/customer',
  hq: '/hq-warehouse',
  hr: '/hr',
  cashier: '/tasks',
  housekeeping_staff: '/tasks',
  boh_staff: '/tasks',
  // ยังไม่ระบุ → หน้าของฉัน (ยังไม่มีเมนูปฏิบัติการ)
  unspecified: '/me',
};
