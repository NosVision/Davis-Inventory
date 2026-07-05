'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  ClipboardCheck,
  Wine,
  ArrowLeftRight,
  Shuffle,
  Warehouse,
  HandCoins,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { getAccessibleModules } from '@/lib/modules/registry';
import { getModuleColors } from '@/lib/utils/module-colors';
import { PageHeader } from '@/components/ui';

// "คลัง" hub (owner-picked nav pattern 2026-07-05): the bottom bar keeps ONE stable warehouse
// button; this page fans out to every warehouse module the user can access. Same registry +
// permission logic as the drawer, so the tile set always matches what they could reach anyway.
const ICONS: Record<string, LucideIcon> = {
  'clipboard-check': ClipboardCheck,
  wine: Wine,
  'arrow-left-right': ArrowLeftRight,
  shuffle: Shuffle,
  warehouse: Warehouse,
  'hand-coins': HandCoins,
};

export default function WarehouseHubPage() {
  const t = useTranslations();
  const { user } = useAuthStore();
  if (!user) return null;

  const tiles = getAccessibleModules(user).filter((m) => m.groupKey === 'moduleGroups.warehouse');

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <PageHeader title={t('moduleGroups.warehouse')} subtitle={t('nav.warehouseHubSubtitle')} />
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((m) => {
          const Icon = ICONS[m.icon] ?? ClipboardCheck;
          const colors = getModuleColors(m.color);
          return (
            <Link
              key={m.id}
              href={m.href}
              className="group flex flex-col items-start gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
            >
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${colors.gradient}`}>
                <Icon className="h-6 w-6 text-white" />
              </span>
              <span className="text-sm font-semibold text-gray-900 dark:text-white">{t(m.nameKey)}</span>
              <span className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{t(m.descriptionKey)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
