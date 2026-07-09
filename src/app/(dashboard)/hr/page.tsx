'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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

// Tile keys that can carry a "needs HR action" count (from /api/hr/dashboard/badges).
const BADGE_KEYS = [
  'leave',
  'attendance',
  'requests',
  'swaps',
  'claims',
  'profileRequests',
  'documentRequests',
  'identityClaims',
] as const;

const HREF_BY_KEY: Record<string, string | undefined> = Object.fromEntries(
  NAV_TILES.map((tile) => [tile.key, tile.href])
);

export default function HrDashboardPage() {
  const t = useTranslations('hr');
  const isTh = useLocale() === 'th';

  // Per-area "needs action" counts → red badge on the relevant tile. Auto-refreshes so the hub
  // reflects new requests/approvals without a manual reload (owner ask 2026-07-09).
  const [badges, setBadges] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/hr/dashboard/badges');
        if (res.ok && alive) setBadges(((await res.json()).data ?? {}) as Record<string, number>);
      } catch {
        /* badges are best-effort — never block the hub */
      }
    };
    load();
    const id = setInterval(load, 45_000); // light poll — keeps the summary + ordering fresh
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Areas that currently need action, most-urgent first — drives the summary strip.
  const pending = useMemo(
    () =>
      BADGE_KEYS.map((key) => ({ key, count: badges[key] ?? 0 }))
        .filter((p) => p.count > 0)
        .sort((a, b) => b.count - a.count),
    [badges]
  );
  const total = pending.reduce((s, p) => s + p.count, 0);

  // Tiles with something pending float to the top (keeping their relative order); the rest stay
  // in the normal layout. If nothing is pending, the order is unchanged.
  const orderedTiles = useMemo(() => {
    const withBadge = NAV_TILES.filter((tile) => (badges[tile.key] ?? 0) > 0);
    const rest = NAV_TILES.filter((tile) => (badges[tile.key] ?? 0) === 0);
    return [...withBadge, ...rest];
  }, [badges]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <PageHeader title={t('dashboard')} subtitle={t('subtitle')} />

      {/* Auto-updating "needs action" summary */}
      {total > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-900/15">
          <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            {isTh ? 'รายการที่ต้องดำเนินการ' : 'Needs action'}
            <span className="ml-1 inline-flex min-w-[22px] items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-bold text-white">
              {total > 99 ? '99+' : total}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {pending.map((p) => {
              const href = HREF_BY_KEY[p.key];
              const chip = (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-1 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:border-amber-400 dark:border-amber-900/50 dark:bg-gray-800 dark:text-gray-100">
                  {t(`nav.${p.key}`)}
                  <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                    {p.count > 99 ? '99+' : p.count}
                  </span>
                </span>
              );
              return href ? (
                <Link key={p.key} href={href}>
                  {chip}
                </Link>
              ) : (
                <span key={p.key}>{chip}</span>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/15 dark:text-emerald-300">
          <ShieldCheck className="h-4 w-4" />
          {isTh ? 'ไม่มีรายการค้าง — เคลียร์หมดแล้ว' : 'All clear — nothing pending'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {orderedTiles.map(({ key, icon: Icon, href }) => {
          const count = badges[key] ?? 0;
          const flagged = count > 0;
          const inner = (
            <>
              {flagged && (
                <span className="absolute right-2 top-2 inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white shadow-sm">
                  {count > 99 ? '99+' : count}
                </span>
              )}
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  flagged
                    ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400'
                }`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{t(`nav.${key}`)}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">{href ? '' : t('comingSoon')}</span>
            </>
          );
          const base = `relative flex flex-col gap-2 rounded-xl border bg-white p-4 dark:bg-gray-800 ${
            flagged
              ? 'border-amber-300 ring-1 ring-amber-200 dark:border-amber-800 dark:ring-amber-900/40'
              : 'border-gray-200 dark:border-gray-700'
          }`;
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
