import type { UserRole, Permission } from '@/types/roles';

export type ManualSectionId =
  | 'intro'
  | 'roles'
  | 'login'
  | 'owner'
  | 'manager'
  | 'bar'
  | 'staff'
  | 'accountant'
  | 'hq'
  | 'deposit'
  | 'stock'
  | 'chat'
  | 'transfer'
  | 'reports'
  | 'notifications'
  | 'settings'
  | 'print'
  | 'commission'
  | 'profile'
  | 'theme'
  | 'summary'
  | 'images'
  | 'hrOverview'
  | 'hrEmployees'
  | 'hrOrg'
  | 'hrTime'
  | 'hrLeave'
  | 'hrDiscipline'
  | 'hrPayroll'
  | 'hrDocuments'
  | 'hrExtraPay'
  | 'hrEvaluation'
  | 'hrAssetsComms'
  | 'hrAudit'
  | 'hrEss';

export interface ManualSection {
  id: ManualSectionId;
  number: number | null;
  titleKey: string;
  descKey: string;
  icon: string;
  iconBg: string;
  /** 'all' = shown to every role, otherwise only shown if user role is in the list */
  roles: 'all' | UserRole[];
  /** Also show the section to any user granted this permission (mirrors module registry gating) */
  permission?: Permission;
  tocGroupKey?: string;
}

export const manualSections: ManualSection[] = [
  // ── System Overview ──
  {
    id: 'intro',
    number: 1,
    titleKey: 'sections.introTitle',
    descKey: 'sections.introDesc',
    icon: '🚀',
    iconBg: 'bg-violet-500',
    roles: 'all',
    tocGroupKey: 'tocGroups.systemOverview',
  },
  {
    id: 'roles',
    number: 2,
    titleKey: 'sections.rolesTitle',
    descKey: 'sections.rolesDesc',
    icon: '👥',
    iconBg: 'bg-blue-500',
    roles: ['owner', 'manager', 'accountant', 'hq'],
    tocGroupKey: 'tocGroups.systemOverview',
  },
  {
    id: 'login',
    number: 3,
    titleKey: 'sections.loginTitle',
    descKey: 'sections.loginDesc',
    icon: '🔒',
    iconBg: 'bg-indigo-500',
    roles: 'all',
    tocGroupKey: 'tocGroups.systemOverview',
  },
  // ── Role Menus ──
  {
    id: 'owner',
    number: 4,
    titleKey: 'sections.ownerTitle',
    descKey: 'sections.ownerDesc',
    icon: '👑',
    iconBg: 'bg-violet-500',
    roles: ['owner'],
    tocGroupKey: 'tocGroups.roleMenus',
  },
  {
    id: 'manager',
    number: 5,
    titleKey: 'sections.managerTitle',
    descKey: 'sections.managerDesc',
    icon: '💼',
    iconBg: 'bg-blue-500',
    roles: ['manager'],
    tocGroupKey: 'tocGroups.roleMenus',
  },
  {
    id: 'bar',
    number: 6,
    titleKey: 'sections.barTitle',
    descKey: 'sections.barDesc',
    icon: '🍻',
    iconBg: 'bg-teal-500',
    roles: ['bar'],
    tocGroupKey: 'tocGroups.roleMenus',
  },
  {
    id: 'staff',
    number: 7,
    titleKey: 'sections.staffTitle',
    descKey: 'sections.staffDesc',
    icon: '🧑‍💼',
    iconBg: 'bg-amber-500',
    roles: ['staff'],
    tocGroupKey: 'tocGroups.roleMenus',
  },
  {
    id: 'accountant',
    number: 8,
    titleKey: 'sections.accountantTitle',
    descKey: 'sections.accountantDesc',
    icon: '💵',
    iconBg: 'bg-orange-500',
    roles: ['accountant'],
    tocGroupKey: 'tocGroups.roleMenus',
  },
  {
    id: 'hq',
    number: 9,
    titleKey: 'sections.hqTitle',
    descKey: 'sections.hqDesc',
    icon: '🏢',
    iconBg: 'bg-cyan-500',
    roles: ['hq'],
    tocGroupKey: 'tocGroups.roleMenus',
  },
  // ── Main Features ──
  {
    id: 'deposit',
    number: 10,
    titleKey: 'sections.depositTitle',
    descKey: 'sections.depositDesc',
    icon: '🍷',
    iconBg: 'bg-emerald-500',
    roles: ['owner', 'manager', 'accountant', 'bar', 'staff', 'hq'],
    tocGroupKey: 'tocGroups.mainFeatures',
  },
  {
    id: 'stock',
    number: 11,
    titleKey: 'sections.stockTitle',
    descKey: 'sections.stockDesc',
    icon: '📋',
    iconBg: 'bg-indigo-500',
    roles: ['owner', 'manager', 'accountant', 'bar', 'hq'],
    tocGroupKey: 'tocGroups.mainFeatures',
  },
  {
    id: 'chat',
    number: 12,
    titleKey: 'sections.chatTitle',
    descKey: 'sections.chatDesc',
    icon: '💬',
    iconBg: 'bg-blue-500',
    roles: ['owner', 'manager', 'accountant', 'bar', 'staff', 'hq'],
    tocGroupKey: 'tocGroups.mainFeatures',
  },
  {
    id: 'transfer',
    number: 13,
    titleKey: 'sections.transferTitle',
    descKey: 'sections.transferDesc',
    icon: '↔',
    iconBg: 'bg-blue-500',
    roles: ['owner', 'manager', 'accountant', 'bar', 'hq'],
    tocGroupKey: 'tocGroups.mainFeatures',
  },
  {
    id: 'reports',
    number: 14,
    titleKey: 'sections.reportsTitle',
    descKey: 'sections.reportsDesc',
    icon: '📊',
    iconBg: 'bg-amber-500',
    roles: ['owner', 'accountant', 'manager', 'hq'],
    tocGroupKey: 'tocGroups.mainFeatures',
  },
  {
    id: 'notifications',
    number: 15,
    titleKey: 'sections.notificationsTitle',
    descKey: 'sections.notificationsDesc',
    icon: '🔔',
    iconBg: 'bg-rose-500',
    roles: 'all',
    tocGroupKey: 'tocGroups.mainFeatures',
  },
  {
    id: 'settings',
    number: 16,
    titleKey: 'sections.settingsTitle',
    descKey: 'sections.settingsDesc',
    icon: '⚙',
    iconBg: 'bg-gray-500',
    roles: ['owner', 'manager'],
    tocGroupKey: 'tocGroups.mainFeatures',
  },
  {
    id: 'print',
    number: 17,
    titleKey: 'sections.printTitle',
    descKey: 'sections.printDesc',
    icon: '🖨',
    iconBg: 'bg-cyan-500',
    roles: ['owner', 'manager', 'bar', 'staff'],
    tocGroupKey: 'tocGroups.mainFeatures',
  },
  {
    id: 'commission',
    number: 18,
    titleKey: 'sections.commissionTitle',
    descKey: 'sections.commissionDesc',
    icon: '💰',
    iconBg: 'bg-amber-500',
    roles: ['owner', 'accountant', 'manager'],
    tocGroupKey: 'tocGroups.mainFeatures',
  },
  // ── HR System (owner / can_manage_hr) ──
  {
    id: 'hrOverview',
    number: 19,
    titleKey: 'sections.hrOverviewTitle',
    descKey: 'sections.hrOverviewDesc',
    icon: '🧑‍💼',
    iconBg: 'bg-teal-500',
    roles: ['owner'],
    permission: 'can_manage_hr',
    tocGroupKey: 'tocGroups.hr',
  },
  {
    id: 'hrEmployees',
    number: 20,
    titleKey: 'sections.hrEmployeesTitle',
    descKey: 'sections.hrEmployeesDesc',
    icon: '👥',
    iconBg: 'bg-teal-500',
    roles: ['owner'],
    permission: 'can_manage_hr',
    tocGroupKey: 'tocGroups.hr',
  },
  {
    id: 'hrOrg',
    number: 21,
    titleKey: 'sections.hrOrgTitle',
    descKey: 'sections.hrOrgDesc',
    icon: '🏢',
    iconBg: 'bg-cyan-500',
    roles: ['owner'],
    permission: 'can_manage_hr',
    tocGroupKey: 'tocGroups.hr',
  },
  {
    id: 'hrTime',
    number: 22,
    titleKey: 'sections.hrTimeTitle',
    descKey: 'sections.hrTimeDesc',
    icon: '⏰',
    iconBg: 'bg-sky-500',
    roles: ['owner'],
    permission: 'can_manage_hr',
    tocGroupKey: 'tocGroups.hr',
  },
  {
    id: 'hrLeave',
    number: 23,
    titleKey: 'sections.hrLeaveTitle',
    descKey: 'sections.hrLeaveDesc',
    icon: '🌴',
    iconBg: 'bg-emerald-500',
    roles: ['owner'],
    permission: 'can_manage_hr',
    tocGroupKey: 'tocGroups.hr',
  },
  {
    id: 'hrDiscipline',
    number: 24,
    titleKey: 'sections.hrDisciplineTitle',
    descKey: 'sections.hrDisciplineDesc',
    icon: '⚠️',
    iconBg: 'bg-amber-500',
    roles: ['owner'],
    permission: 'can_manage_hr',
    tocGroupKey: 'tocGroups.hr',
  },
  {
    id: 'hrPayroll',
    number: 25,
    titleKey: 'sections.hrPayrollTitle',
    descKey: 'sections.hrPayrollDesc',
    icon: '💰',
    iconBg: 'bg-green-600',
    roles: ['owner'],
    permission: 'can_manage_hr',
    tocGroupKey: 'tocGroups.hr',
  },
  {
    id: 'hrDocuments',
    number: 26,
    titleKey: 'sections.hrDocumentsTitle',
    descKey: 'sections.hrDocumentsDesc',
    icon: '📄',
    iconBg: 'bg-indigo-500',
    roles: ['owner'],
    permission: 'can_manage_hr',
    tocGroupKey: 'tocGroups.hr',
  },
  {
    id: 'hrExtraPay',
    number: 27,
    titleKey: 'sections.hrExtraPayTitle',
    descKey: 'sections.hrExtraPayDesc',
    icon: '🪙',
    iconBg: 'bg-yellow-500',
    roles: ['owner'],
    permission: 'can_manage_hr',
    tocGroupKey: 'tocGroups.hr',
  },
  {
    id: 'hrEvaluation',
    number: 28,
    titleKey: 'sections.hrEvaluationTitle',
    descKey: 'sections.hrEvaluationDesc',
    icon: '⭐',
    iconBg: 'bg-orange-500',
    roles: ['owner'],
    permission: 'can_manage_hr',
    tocGroupKey: 'tocGroups.hr',
  },
  {
    id: 'hrAssetsComms',
    number: 29,
    titleKey: 'sections.hrAssetsCommsTitle',
    descKey: 'sections.hrAssetsCommsDesc',
    icon: '📦',
    iconBg: 'bg-violet-500',
    roles: ['owner'],
    permission: 'can_manage_hr',
    tocGroupKey: 'tocGroups.hr',
  },
  {
    id: 'hrAudit',
    number: 30,
    titleKey: 'sections.hrAuditTitle',
    descKey: 'sections.hrAuditDesc',
    icon: '🛡️',
    iconBg: 'bg-gray-500',
    roles: ['owner'],
    permission: 'can_manage_hr',
    tocGroupKey: 'tocGroups.hr',
  },
  {
    id: 'hrEss',
    number: 31,
    titleKey: 'sections.hrEssTitle',
    descKey: 'sections.hrEssDesc',
    icon: '👤',
    iconBg: 'bg-teal-600',
    roles: ['owner'],
    permission: 'can_manage_hr',
    tocGroupKey: 'tocGroups.hr',
  },
  {
    id: 'profile',
    number: null,
    titleKey: 'sections.profileTitle',
    descKey: 'sections.profileDesc',
    icon: '👤',
    iconBg: 'bg-orange-500',
    roles: 'all',
  },
  {
    id: 'theme',
    number: null,
    titleKey: 'sections.themeTitle',
    descKey: 'sections.themeDesc',
    icon: '🎨',
    iconBg: 'bg-violet-500',
    roles: 'all',
  },
  {
    id: 'summary',
    number: null,
    titleKey: 'sections.summaryTitle',
    descKey: 'sections.summaryDesc',
    icon: '📝',
    iconBg: 'bg-indigo-500',
    roles: ['owner', 'manager', 'accountant', 'hq'],
  },
];

export const ROLE_COLOR_CLASSES: Record<UserRole, { badge: string; badgeDark: string; tocNum?: string }> = {
  owner: {
    badge: 'bg-violet-100 text-violet-700',
    badgeDark: 'dark:bg-violet-900 dark:text-violet-300',
    tocNum: 'bg-violet-500',
  },
  manager: {
    badge: 'bg-blue-100 text-blue-700',
    badgeDark: 'dark:bg-blue-900 dark:text-blue-300',
    tocNum: 'bg-blue-500',
  },
  bar: {
    badge: 'bg-teal-100 text-teal-700',
    badgeDark: 'dark:bg-teal-900 dark:text-teal-300',
    tocNum: 'bg-teal-500',
  },
  technician: {
    badge: 'bg-rose-100 text-rose-700',
    badgeDark: 'dark:bg-rose-900 dark:text-rose-300',
    tocNum: 'bg-rose-500',
  },
  staff: {
    badge: 'bg-amber-100 text-amber-700',
    badgeDark: 'dark:bg-amber-900 dark:text-amber-300',
    tocNum: 'bg-amber-500',
  },
  accountant: {
    badge: 'bg-orange-100 text-orange-700',
    badgeDark: 'dark:bg-orange-900 dark:text-orange-300',
    tocNum: 'bg-orange-500',
  },
  hq: {
    badge: 'bg-cyan-100 text-cyan-700',
    badgeDark: 'dark:bg-cyan-900 dark:text-cyan-300',
    tocNum: 'bg-cyan-500',
  },
  // Customer is LIFF-only and never reaches /guide; entry kept for type completeness
  customer: {
    badge: 'bg-emerald-100 text-emerald-700',
    badgeDark: 'dark:bg-emerald-900 dark:text-emerald-300',
    tocNum: 'bg-emerald-500',
  },
  hr: {
    badge: 'bg-fuchsia-100 text-fuchsia-700',
    badgeDark: 'dark:bg-fuchsia-900 dark:text-fuchsia-300',
    tocNum: 'bg-fuchsia-500',
  },
};
