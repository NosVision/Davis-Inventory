export type UserRole =
  | 'owner'
  | 'accountant'
  | 'manager'
  | 'bar'
  | 'technician'
  | 'staff'
  | 'customer'
  | 'hq'
  | 'hr'
  | 'cashier'
  | 'housekeeping_staff'
  | 'boh_staff';

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
  | 'can_manage_hr';

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
  // Technician → ช่างซ่อมบำรุง (Maintenance): งานประจำ (Task) + แจ้ง/รับงานซ่อม
  technician: ['can_manage_repair', 'can_request_repair'],
  // Staff = ฝากเหล้า / เบิกเหล้า / แชท / แจ้งซ่อม
  staff: ['can_manage_deposit', 'can_request_repair'],
  customer: ['can_view_own_deposits', 'can_request_withdrawal'],
  hq: ['can_transfer', 'can_view_reports'],
  // HR = ฝ่ายบุคคล: HR + จัดการผู้ใช้ (โมเดลใหม่ 2026-07-08 — แคบลง เหลือ HR + baseline)
  hr: ['can_manage_hr', 'can_manage_users'],
  // Cashier = AE (คอมมิชชั่น) + งานประจำ
  cashier: ['can_manage_commission'],
  // House Keeping = งานประจำ (Task) เท่านั้น
  housekeeping_staff: [],
  // BOH (หลังร้าน) = งานประจำ (Task) เท่านั้น
  boh_staff: [],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'เจ้าของร้าน',
  accountant: 'บัญชี',
  manager: 'คนคุมร้าน',
  bar: 'บาร์',
  technician: 'ช่างซ่อมบำรุง',
  staff: 'พนักงาน',
  customer: 'ลูกค้า',
  hq: 'พนักงานคลังกลาง',
  hr: 'ฝ่ายบุคคล',
  cashier: 'แคชเชียร์',
  housekeeping_staff: 'แม่บ้าน',
  boh_staff: 'พนักงานหลังร้าน (BOH)',
};

/** Translation keys for role labels — use with useTranslations() */
export const ROLE_LABEL_KEYS: Record<UserRole, string> = {
  owner: 'roles.owner',
  accountant: 'roles.accountant',
  manager: 'roles.manager',
  bar: 'roles.bar',
  technician: 'roles.technician',
  staff: 'roles.staff',
  customer: 'roles.customer',
  hq: 'roles.hq',
  hr: 'roles.hr',
  cashier: 'roles.cashier',
  housekeeping_staff: 'roles.housekeeping_staff',
  boh_staff: 'roles.boh_staff',
};

export const ROLE_HOME_ROUTES: Record<UserRole, string> = {
  owner: '/overview',
  // accountant + cashier home on their AE (commission) surface
  accountant: '/commission',
  // manager no longer lands on store-overview (removed from their menu) — the shared Task hub
  manager: '/tasks',
  bar: '/chat',
  technician: '/tasks',
  staff: '/chat',
  customer: '/customer',
  hq: '/hq-warehouse',
  hr: '/hr',
  cashier: '/tasks',
  housekeeping_staff: '/tasks',
  boh_staff: '/tasks',
};
