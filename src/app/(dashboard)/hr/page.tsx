'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
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
  FileText,
  UserCog,
  UserMinus,
  UserCheck2,
  Network,
  Building2,
  SlidersHorizontal,
  Archive,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui';

/**
 * HR module landing / dashboard (P0.3). Tiles route to sub-sections as they land
 * (P1–P5); tiles without an `href` are placeholders.
 */
const NAV_TILES: { key: string; icon: LucideIcon; href?: string }[] = [
  { key: 'today', icon: LayoutDashboard, href: '/hr/dashboard' },
  { key: 'employees', icon: Users, href: '/hr/employees' },
  { key: 'users', icon: UserCog, href: '/users' },
  { key: 'identityClaims', icon: UserCheck2, href: '/hr/identity-claims' },
  { key: 'org', icon: Briefcase, href: '/hr/org' },
  { key: 'orgChart', icon: Network, href: '/hr/org-chart' },
  { key: 'companies', icon: Building2, href: '/hr/companies' },
  { key: 'policySettings', icon: SlidersHorizontal, href: '/hr/policy-settings' },
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
  { key: 'payroll', icon: Wallet, href: '/hr/payroll' },
  { key: 'importedPayslips', icon: Archive, href: '/hr/imported-payslips' },
  { key: 'documentRequests', icon: FileText, href: '/hr/document-requests' },
  { key: 'certificates', icon: FileText, href: '/hr/certificates' },
  { key: 'serviceCharge', icon: Coins, href: '/hr/service-charge' },
  { key: 'tipPool', icon: Coins, href: '/hr/tip-pool' },
  { key: 'evaluation', icon: Star, href: '/hr/evaluation' },
  { key: 'assets', icon: Package, href: '/hr/assets' },
  { key: 'policies', icon: BookOpen, href: '/hr/policies' },
  { key: 'announcements', icon: Megaphone, href: '/hr/announcements' },
  { key: 'audit', icon: ShieldCheck, href: '/hr/audit' },
  { key: 'reports', icon: BarChart3, href: '/hr/reports' },
];

export default function HrDashboardPage() {
  const t = useTranslations('hr');

  // Per-area "needs action" counts → red badge on the relevant tile (best-effort).
  const [badges, setBadges] = useState<Record<string, number>>({});
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/dashboard/badges');
        if (res.ok) setBadges(((await res.json()).data ?? {}) as Record<string, number>);
      } catch { /* badges are best-effort — never block the hub */ }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <PageHeader title={t('dashboard')} subtitle={t('subtitle')} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {NAV_TILES.map(({ key, icon: Icon, href }) => {
          const count = badges[key] ?? 0;
          const inner = (
            <>
              {count > 0 && (
                <span className="absolute right-2 top-2 inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white shadow-sm">
                  {count > 99 ? '99+' : count}
                </span>
              )}
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
            'relative flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800';
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
