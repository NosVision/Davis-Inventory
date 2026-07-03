'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Users,
  Briefcase,
  Clock,
  CalendarDays,
  CalendarClock,
  CalendarX,
  Repeat,
  AlertTriangle,
  Wallet,
  Coins,
  Star,
  Package,
  BookOpen,
  Megaphone,
  ShieldCheck,
  BarChart3,
  ClipboardList,
  Settings,
  Receipt,
  UserCog,
  UserMinus,
  type LucideIcon,
} from 'lucide-react';

/**
 * HR module landing / dashboard (P0.3). Tiles route to sub-sections as they land
 * (P1–P5); tiles without an `href` are placeholders.
 */
const NAV_TILES: { key: string; icon: LucideIcon; href?: string }[] = [
  { key: 'employees', icon: Users, href: '/hr/employees' },
  { key: 'org', icon: Briefcase, href: '/hr/org' },
  { key: 'attendance', icon: Clock, href: '/hr/attendance' },
  { key: 'schedule', icon: CalendarDays, href: '/hr/schedule' },
  { key: 'timesheet', icon: CalendarClock, href: '/hr/timesheet' },
  { key: 'swaps', icon: Repeat, href: '/hr/swaps' },
  { key: 'requests', icon: ClipboardList, href: '/hr/requests' },
  { key: 'leave', icon: CalendarX, href: '/hr/leaves' },
  { key: 'leaveTypes', icon: Settings, href: '/hr/leave-types' },
  { key: 'warnings', icon: AlertTriangle, href: '/hr/warnings' },
  { key: 'claims', icon: Receipt, href: '/hr/claims' },
  { key: 'profileRequests', icon: UserCog, href: '/hr/profile-requests' },
  { key: 'offboarding', icon: UserMinus, href: '/hr/offboarding' },
  { key: 'payroll', icon: Wallet },
  { key: 'serviceCharge', icon: Coins },
  { key: 'evaluation', icon: Star },
  { key: 'assets', icon: Package, href: '/hr/assets' },
  { key: 'policies', icon: BookOpen, href: '/hr/policies' },
  { key: 'announcements', icon: Megaphone, href: '/hr/announcements' },
  { key: 'audit', icon: ShieldCheck, href: '/hr/audit' },
  { key: 'reports', icon: BarChart3 },
];

export default function HrDashboardPage() {
  const t = useTranslations('hr');

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('dashboard')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {NAV_TILES.map(({ key, icon: Icon, href }) => {
          const inner = (
            <>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400">
                <Icon className="h-5 w-5" />
              </div>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{t(`nav.${key}`)}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {href ? '' : t('comingSoon')}
              </span>
            </>
          );
          const base =
            'flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800';
          return href ? (
            <Link
              key={key}
              href={href}
              className={`${base} transition-colors hover:border-teal-300 hover:bg-teal-50/40 dark:hover:border-teal-700 dark:hover:bg-teal-900/10`}
            >
              {inner}
            </Link>
          ) : (
            <div key={key} className={base}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
