export type UserRole = 'owner' | 'accountant' | 'manager' | 'bar' | 'technician' | 'staff' | 'customer' | 'hq' | 'hr';

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
  // Technician = ช่าง: รับงานซ่อม อัปเดตสถานะ งานประจำ + แจ้งซ่อมได้
  technician: ['can_manage_repair', 'can_request_repair'],
  // Staff = ฝากเหล้า / เบิกเหล้า / แชท / แจ้งซ่อม
  staff: ['can_manage_deposit', 'can_request_repair'],
  customer: ['can_view_own_deposits', 'can_request_withdrawal'],
  hq: ['can_transfer', 'can_view_reports'],
  // HR = ฝ่ายบุคคล: ทุกหน้ายกเว้นฝากเหล้า + นับสต๊อก (จึงไม่มี can_*_deposit / can_*_stock)
  hr: [
    'can_manage_hr',
    'can_view_reports',
    'can_manage_users',
    'can_manage_settings',
    'can_manage_commission',
    'can_transfer',
    'can_borrow',
    'can_request_repair',
    'can_manage_repair',
  ],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'เจ้าของร้าน',
  accountant: 'บัญชี',
  manager: 'คนคุมร้าน',
  bar: 'บาร์',
  technician: 'ช่าง',
  staff: 'พนักงาน',
  customer: 'ลูกค้า',
  hq: 'พนักงานคลังกลาง',
  hr: 'ฝ่ายบุคคล',
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
};

export const ROLE_HOME_ROUTES: Record<UserRole, string> = {
  owner: '/overview',
  accountant: '/reports',
  manager: '/store-overview',
  bar: '/chat',
  technician: '/tasks',
  staff: '/chat',
  customer: '/customer',
  hq: '/hq-warehouse',
  hr: '/hr',
};
