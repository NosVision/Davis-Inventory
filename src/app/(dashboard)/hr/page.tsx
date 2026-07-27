'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils/cn';
import { Button } from '@/components/ui';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Clock,
  CalendarDays,
  CalendarClock,
  CalendarCheck,
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
  Network,
  Building2,
  SlidersHorizontal,
  Archive,
  MapPin,
  Pin,
  PinOff,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui';

/**
 * HR module landing / dashboard (P0.3). Tiles route to sub-sections as they land
 * (P1–P5); tiles without an `href` are placeholders.
 */
const NAV_TILES: { key: string; icon: LucideIcon; href?: string }[] = [
  { key: 'close', icon: CalendarCheck, href: '/hr/close' },
  { key: 'today', icon: LayoutDashboard, href: '/hr/dashboard' },
  // "ผู้ใช้ในระบบ" + "ยืนยันตัวตนพนักงาน" merged into the employees surface (2026-07-27) —
  // accounts live on /hr/employees?tab=accounts, the identity-claims queue behind its
  // คำขอยืนยันตัวตน card (?view=claims). ONE tile covers the person, their login, and claims.
  { key: 'employees', icon: Users, href: '/hr/employees' },
  { key: 'org', icon: Briefcase, href: '/hr/org' },
  { key: 'orgChart', icon: Network, href: '/hr/org-chart' },
  { key: 'companies', icon: Building2, href: '/hr/companies' },
  { key: 'policySettings', icon: SlidersHorizontal, href: '/hr/policy-settings' },
  { key: 'attendance', icon: Clock, href: '/hr/attendance' },
  { key: 'locations', icon: MapPin, href: '/hr/locations' },
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
  { key: 'stockDeductions', icon: Coins, href: '/hr/stock-deductions' },
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

const HREF_BY_KEY: Record<string, string | undefined> = {
  ...Object.fromEntries(NAV_TILES.map((tile) => [tile.key, tile.href])),
  // identity-claims merged into the accounts tab — its "needs action" chip deep-links there.
  identityClaims: '/hr/employees?tab=accounts&view=claims',
};

export default function HrDashboardPage() {
  const t = useTranslations('hr');
  const isTh = useLocale() === 'th';
  const { user } = useAuthStore();

  // Per-account pinned tiles (owner ask 2026-07-27) — saved to user_ui_prefs.hr_tile_order and
  // auto-loaded here, so each account keeps its own default order. In จัดเรียง mode, tapping a
  // tile pins/unpins it; pin order = tap order; every change saves immediately.
  const [pinned, setPinned] = useState<string[]>([]);
  const [editMode, setEditMode] = useState(false);
  useEffect(() => {
    if (!user) return;
    (async () => {
      const supabase = createClient();
      // RLS scopes the row to the signed-in account — no explicit user filter needed.
      const { data } = await supabase.from('user_ui_prefs').select('hr_tile_order').maybeSingle();
      const saved = (data?.hr_tile_order as string[] | null) ?? [];
      setPinned(saved.filter((k) => NAV_TILES.some((tile) => tile.key === k)));
    })();
  }, [user]);

  const savePinned = useCallback(
    async (next: string[]) => {
      setPinned(next);
      if (!user) return;
      const supabase = createClient();
      await supabase
        .from('user_ui_prefs')
        .upsert({ user_id: user.id, hr_tile_order: next, updated_at: new Date().toISOString() });
    },
    [user]
  );
  const togglePin = (key: string) =>
    savePinned(pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key]);

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

  // Tile badges — identity-claims merged into the employees surface, so its count rides on the
  // employees tile (the standalone tile is gone; the summary chip still deep-links to the queue).
  const tileBadges = useMemo(() => {
    const t: Record<string, number> = { ...badges };
    t.employees = (t.employees ?? 0) + (t.identityClaims ?? 0);
    return t;
  }, [badges]);

  // Order: pinned tiles first (in the account's saved order), then tiles with something pending
  // (badge float), then everything else in the default layout.
  const orderedTiles = useMemo(() => {
    const byKey = new Map(NAV_TILES.map((tile) => [tile.key, tile]));
    const pinSet = new Set(pinned);
    const pinnedTiles = pinned
      .map((k) => byKey.get(k))
      .filter((tile): tile is (typeof NAV_TILES)[number] => !!tile);
    const rest = NAV_TILES.filter((tile) => !pinSet.has(tile.key));
    const withBadge = rest.filter((tile) => (tileBadges[tile.key] ?? 0) > 0);
    const calm = rest.filter((tile) => (tileBadges[tile.key] ?? 0) === 0);
    return [...pinnedTiles, ...withBadge, ...calm];
  }, [tileBadges, pinned]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <PageHeader
        title={t('dashboard')}
        subtitle={t('subtitle')}
        actions={
          <Button
            size="sm"
            variant={editMode ? 'primary' : 'outline'}
            onClick={() => setEditMode((v) => !v)}
            icon={editMode ? <Check className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          >
            {editMode ? (isTh ? 'เสร็จสิ้น' : 'Done') : isTh ? 'ปักหมุดเมนู' : 'Pin tiles'}
          </Button>
        }
      />

      {editMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300">
          <Pin className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            {isTh
              ? 'แตะเมนูเพื่อปักหมุด/ถอนหมุด — เมนูที่ปักจะขึ้นก่อนตามลำดับที่แตะ และบันทึกเป็นค่าเริ่มต้นของบัญชีนี้ทันที'
              : 'Tap a tile to pin/unpin — pinned tiles come first in tap order, saved instantly as this account’s default.'}
          </span>
          {pinned.length > 0 && (
            <button
              type="button"
              onClick={() => savePinned([])}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 px-2 py-1 text-xs font-medium hover:bg-indigo-100 dark:border-indigo-700 dark:hover:bg-indigo-900/40"
            >
              <PinOff className="h-3 w-3" />
              {isTh ? 'ล้างหมุดทั้งหมด' : 'Clear all pins'}
            </button>
          )}
        </div>
      )}

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
          const count = tileBadges[key] ?? 0;
          const flagged = count > 0;
          const pinIdx = pinned.indexOf(key);
          const isPinned = pinIdx >= 0;
          const inner = (
            <>
              {flagged && (
                <span className="absolute right-2 top-2 inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white shadow-sm">
                  {count > 99 ? '99+' : count}
                </span>
              )}
              {/* Pin marker: edit mode shows the toggle + order number; normal mode a subtle pin */}
              {editMode ? (
                <span
                  className={cn(
                    'absolute left-2 top-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none',
                    isPinned
                      ? 'bg-indigo-500 text-white shadow-sm'
                      : 'border border-dashed border-gray-300 text-gray-300 dark:border-gray-600 dark:text-gray-600'
                  )}
                >
                  {isPinned ? pinIdx + 1 : <Pin className="h-3 w-3" />}
                </span>
              ) : (
                isPinned && (
                  <Pin className="absolute left-2 top-2 h-3.5 w-3.5 text-indigo-400 dark:text-indigo-500" />
                )
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
          // จัดเรียง mode: tiles become pin toggles (no navigation) so a stray tap can't leave.
          if (editMode) {
            return (
              <button
                key={key}
                type="button"
                onClick={() => togglePin(key)}
                className={cn(
                  base,
                  'text-left transition-colors',
                  isPinned
                    ? 'border-indigo-300 ring-1 ring-indigo-200 dark:border-indigo-700 dark:ring-indigo-900/40'
                    : 'hover:border-indigo-300 dark:hover:border-indigo-700'
                )}
              >
                {inner}
              </button>
            );
          }
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
