'use client';

import { useTranslations } from 'next-intl';
import {
  Users,
  Clock,
  CalendarDays,
  CalendarX,
  AlertTriangle,
  Wallet,
  Coins,
  Star,
  Package,
  BookOpen,
  Megaphone,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';

/**
 * HR module landing / dashboard skeleton (P0.3).
 * Sub-sections are wired in later phases (P1–P5); tiles are placeholders for now.
 */
const NAV_TILES: { key: string; icon: LucideIcon }[] = [
  { key: 'employees', icon: Users },
  { key: 'attendance', icon: Clock },
  { key: 'schedule', icon: CalendarDays },
  { key: 'leave', icon: CalendarX },
  { key: 'warnings', icon: AlertTriangle },
  { key: 'payroll', icon: Wallet },
  { key: 'serviceCharge', icon: Coins },
  { key: 'evaluation', icon: Star },
  { key: 'assets', icon: Package },
  { key: 'policies', icon: BookOpen },
  { key: 'announcements', icon: Megaphone },
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
        {NAV_TILES.map(({ key, icon: Icon }) => (
          <div
            key={key}
            className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400">
              <Icon className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {t(`nav.${key}`)}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{t('comingSoon')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
