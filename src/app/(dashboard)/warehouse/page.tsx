'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  MessageCircle,
  UserCircle,
  ClipboardList,
  Warehouse,
  Inbox,
  ClipboardCheck,
  Wine,
  ArrowLeftRight,
  Shuffle,
  HandCoins,
  UserCog,
  FileBarChart,
  ShieldCheck,
  Trophy,
  Scale,
  Zap,
  PieChart,
  BookOpen,
  Megaphone,
  Settings,
  Wrench,
  CalendarDays,
  Repeat,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { getAccessibleModules, type ModuleConfig } from '@/lib/modules/registry';
import { getModuleColors } from '@/lib/utils/module-colors';
import { PageHeader } from '@/components/ui';
import { useInboxCount } from '@/hooks/use-inbox-count';
import { useMyTasksCount } from '@/hooks/use-my-tasks-count';
import { useHrPendingCount } from '@/hooks/use-hr-pending-count';
import { cn } from '@/lib/utils/cn';

// "Main" hub (owner ask 2026-07-08): the small-screen bottom bar keeps ONE stable left-most button
// that fans out to EVERY module the user can access, grouped exactly like the desktop drawer
// (main / warehouse / accounting / HR / reports / analytics / help / system). Same registry +
// permission logic as the sidebar, so the tile set always matches what they could reach anyway.
const ICONS: Record<string, LucideIcon> = {
  'layout-dashboard': LayoutDashboard,
  'message-circle': MessageCircle,
  'user-circle': UserCircle,
  'clipboard-list': ClipboardList,
  warehouse: Warehouse,
  inbox: Inbox,
  'clipboard-check': ClipboardCheck,
  wine: Wine,
  'arrow-left-right': ArrowLeftRight,
  shuffle: Shuffle,
  'hand-coins': HandCoins,
  'user-cog': UserCog,
  'file-bar-chart': FileBarChart,
  'shield-check': ShieldCheck,
  trophy: Trophy,
  scale: Scale,
  zap: Zap,
  'pie-chart': PieChart,
  'book-open': BookOpen,
  megaphone: Megaphone,
  settings: Settings,
  wrench: Wrench,
  'calendar-days': CalendarDays,
  repeat: Repeat,
};

// Display order of the groups on the hub (missing groups fall to the end, keeping registry order).
const GROUP_ORDER = [
  'moduleGroups.main',
  'moduleGroups.warehouse',
  'moduleGroups.accounting',
  'moduleGroups.hr',
  'moduleGroups.maintenance',
  'moduleGroups.reports',
  'moduleGroups.analytics',
  'moduleGroups.help',
  'moduleGroups.system',
];

export default function MainHubPage() {
  const t = useTranslations();
  const isTh = useLocale() === 'th';
  const { user } = useAuthStore();
  const inboxCount = useInboxCount();
  const myTasksCount = useMyTasksCount();
  const hrPendingCount = useHrPendingCount();
  const [query, setQuery] = useState('');

  // Group the accessible modules by their registry groupKey, then order the groups for display.
  const groups = useMemo(() => {
    if (!user) return [] as [string, ModuleConfig[]][];
    const map = new Map<string, ModuleConfig[]>();
    for (const m of getAccessibleModules(user)) {
      const list = map.get(m.groupKey) ?? [];
      list.push(m);
      map.set(m.groupKey, list);
    }
    const rank = (key: string) => {
      const i = GROUP_ORDER.indexOf(key);
      return i < 0 ? GROUP_ORDER.length : i;
    };
    return [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [user]);

  if (!user) return null;

  const badgeFor = (m: ModuleConfig): number => {
    if (m.badge === 'pending_count') return inboxCount;
    if (m.badge === 'my_tasks_count') return myTasksCount;
    if (m.badge === 'hr_pending_count') return hrPendingCount;
    return 0;
  };

  const q = query.trim().toLowerCase();
  const visibleGroups = groups
    .map(([key, items]) => {
      const filtered = q
        ? items.filter(
            (m) => t(m.nameKey).toLowerCase().includes(q) || t(m.descriptionKey).toLowerCase().includes(q)
          )
        : items;
      return [key, filtered] as [string, ModuleConfig[]];
    })
    .filter(([, items]) => items.length > 0);

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-24">
      <PageHeader title={t('nav.main')} subtitle={t('nav.mainHubSubtitle')} />

      {/* Sticky quick-filter — fast reach on a phone without scrolling the whole list */}
      <div className="sticky top-0 z-10 -mx-4 bg-gray-50/85 px-4 py-2 backdrop-blur dark:bg-gray-900/85">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isTh ? 'ค้นหาเมนู…' : 'Search menus…'}
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-teal-900/40"
          />
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">{isTh ? 'ไม่พบเมนูที่ค้นหา' : 'No menus match your search'}</p>
      ) : (
        visibleGroups.map(([key, items]) => (
          <section key={key} className="space-y-2.5">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {t(key)}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((m) => {
                const Icon = ICONS[m.icon] ?? ClipboardCheck;
                const colors = getModuleColors(m.color);
                const count = badgeFor(m);
                return (
                  <Link
                    key={m.id}
                    href={m.href}
                    className="group relative flex flex-col items-start gap-2 rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md active:translate-y-0 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-teal-700"
                  >
                    {count > 0 && (
                      <span className="absolute right-2 top-2 inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white shadow-sm">
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                    <span
                      className={cn(
                        'flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm',
                        colors.gradient
                      )}
                    >
                      <Icon className="h-6 w-6 text-white" />
                    </span>
                    <span className="text-sm font-semibold leading-tight text-gray-900 dark:text-white">{t(m.nameKey)}</span>
                    <span className="line-clamp-2 text-xs leading-snug text-gray-500 dark:text-gray-400">
                      {t(m.descriptionKey)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
