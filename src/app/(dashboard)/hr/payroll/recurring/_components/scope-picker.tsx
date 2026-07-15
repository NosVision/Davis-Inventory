'use client';

import { useTranslations } from 'next-intl';
import { CalendarClock, History, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

// How a recurring item's period window is chosen when adding it. Replaces a bare month input
// (which an HR user could silently clear → retroactive-forever, back-filling already-finalized
// or imported months). The choice is now explicit (owner ask 2026-07-15).
export type ScopeMode = 'current' | 'retro' | 'custom';

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

/** Resolve the picker state into the API's start_period/end_period ('YYYY-MM' or null). */
export function resolveScope(
  mode: ScopeMode,
  currentPeriod: string,
  startPeriod: string,
  endPeriod: string
): { start_period: string | null; end_period: string | null } {
  if (mode === 'retro') return { start_period: null, end_period: null };
  if (mode === 'custom') return { start_period: startPeriod || null, end_period: endPeriod || null };
  // 'current' — starts THIS period, never touches finalized/imported past months.
  return { start_period: currentPeriod, end_period: null };
}

interface ScopePickerProps {
  mode: ScopeMode;
  onModeChange: (m: ScopeMode) => void;
  currentPeriod: string;
  startPeriod: string;
  endPeriod: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
}

export function ScopePicker({
  mode,
  onModeChange,
  currentPeriod,
  startPeriod,
  endPeriod,
  onStartChange,
  onEndChange,
}: ScopePickerProps) {
  const t = useTranslations('hr.payroll.recurringPage.scope');
  const options: { value: ScopeMode; label: string; hint: string; icon: typeof CalendarClock }[] = [
    { value: 'current', label: t('currentLabel'), hint: t('currentHint', { period: currentPeriod }), icon: CalendarClock },
    { value: 'retro', label: t('retroLabel'), hint: t('retroHint'), icon: History },
    { value: 'custom', label: t('customLabel'), hint: t('customHint'), icon: SlidersHorizontal },
  ];

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{t('heading')}</p>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {options.map((o) => {
          const Icon = o.icon;
          const active = mode === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onModeChange(o.value)}
              aria-pressed={active}
              className={cn(
                'flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                active
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-900/20 dark:text-indigo-300'
                  : 'border-gray-300 text-gray-600 hover:border-gray-400 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500'
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {o.label}
              </span>
              <span className="text-[10px] leading-tight opacity-80">{o.hint}</span>
            </button>
          );
        })}
      </div>

      {mode === 'retro' && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          {t('retroWarning')}
        </p>
      )}

      {mode === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            {t('startPeriod')}
            <input type="month" value={startPeriod} onChange={(e) => onStartChange(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            {t('endPeriod')}
            <input type="month" value={endPeriod} onChange={(e) => onEndChange(e.target.value)} min={startPeriod || undefined} className={inputCls} />
          </label>
        </div>
      )}
    </div>
  );
}
