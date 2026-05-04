'use client';

import { useTranslations } from 'next-intl';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/stores/app-store';
import { yesterdayBangkok, dayOfWeekBangkok } from '@/lib/utils/date';
import { formatThaiDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { ClipboardCheck, ClipboardList, CalendarOff, AlertTriangle, FileText, CheckCircle2 } from 'lucide-react';

type BannerState =
  | { type: 'loading' }
  | { type: 'not_counting_day' }
  | { type: 'no_settings' }
  | { type: 'not_counted'; totalProducts: number; supplementary: number }
  | {
      // The count happened, but compare hasn't run yet (POS not uploaded
      // or auto-compare hasn't fired) — staff can keep ticking off rows.
      type: 'counting';
      countedItems: number;
      totalProducts: number;
      supplementary: number;
    }
  | {
      // Comparison rows exist for the day — counting + compare are done.
      // What's left to act on is supplementary count or explanation.
      type: 'compared';
      countedItems: number;
      totalProducts: number;
      supplementary: number;
      pendingExplanation: number;
      pendingApproval: number;
    };

export function StockCountBanner() {
  const t = useTranslations('stock');
  const { currentStoreId } = useAppStore();
  const [state, setState] = useState<BannerState>({ type: 'loading' });

  const check = useCallback(async () => {
    if (!currentStoreId) return;

    const supabase = createClient();
    const todayDay = dayOfWeekBangkok();
    const businessDate = yesterdayBangkok();

    // 1. Fetch store settings
    const { data: settings } = await supabase
      .from('store_settings')
      .select('notify_days, daily_reminder_enabled')
      .eq('store_id', currentStoreId)
      .single();

    if (!settings) {
      setState({ type: 'no_settings' });
      return;
    }

    const notifyDays: string[] = settings.notify_days || [];

    // Check if today is a counting day
    if (!notifyDays.includes(todayDay)) {
      setState({ type: 'not_counting_day' });
      return;
    }

    // 2. Count total active products
    const { count: totalProducts } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', currentStoreId)
      .eq('active', true)
      .eq('count_status', 'active');

    // 3. Count manual_counts for business date
    const { count: countedItems } = await supabase
      .from('manual_counts')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', currentStoreId)
      .eq('count_date', businessDate);

    const total = totalProducts ?? 0;
    const counted = countedItems ?? 0;

    if (counted === 0) {
      // Skip the comparison/supplementary lookups — user hasn't even
      // started, the "go count now" CTA is the only thing that matters.
      const { count: supplementaryCount } = await supabase
        .from('comparisons')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', currentStoreId)
        .eq('comp_date', businessDate)
        .is('manual_quantity', null);
      setState({
        type: 'not_counted',
        totalProducts: total,
        supplementary: supplementaryCount ?? 0,
      });
      return;
    }

    // 4. Pull comparison rows for the day in one shot, then derive the
    //    three states (supplementary / pending explanation / pending
    //    approval) from a single result set. Avoids three round trips
    //    and keeps the counts internally consistent.
    const { data: compRows } = await supabase
      .from('comparisons')
      .select('status, manual_quantity, difference')
      .eq('store_id', currentStoreId)
      .eq('comp_date', businessDate);

    if (!compRows || compRows.length === 0) {
      // Manual count exists but compare hasn't run yet — still
      // "counting in progress" from the user's POV.
      setState({
        type: 'counting',
        countedItems: counted,
        totalProducts: total,
        supplementary: 0,
      });
      return;
    }

    const supplementary = compRows.filter((c) => c.manual_quantity === null).length;
    // Real over-tolerance rows that need an explanation. POS-only rows
    // share status='pending' but aren't an explanation request — they're
    // a "go count" request, surfaced separately as `supplementary`.
    const pendingExplanation = compRows.filter(
      (c) => c.status === 'pending' && c.manual_quantity !== null,
    ).length;
    const pendingApproval = compRows.filter((c) => c.status === 'explained').length;

    setState({
      type: 'compared',
      countedItems: counted,
      totalProducts: total,
      supplementary,
      pendingExplanation,
      pendingApproval,
    });
  }, [currentStoreId]);

  useEffect(() => {
    check();
  }, [check]);

  if (state.type === 'loading' || state.type === 'no_settings') {
    return null;
  }

  const businessDate = yesterdayBangkok();
  const dateLabel = formatThaiDate(businessDate);

  if (state.type === 'not_counting_day') {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-800/50">
        <CalendarOff className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('banner.notCountingDay')}
          </p>
        </div>
      </div>
    );
  }

  if (state.type === 'not_counted') {
    return (
      <div className="space-y-2">
        <a
          href="/stock/daily-check"
          className={cn(
            'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
            'border-amber-200 bg-amber-50 hover:bg-amber-100',
            'dark:border-amber-800 dark:bg-amber-900/20 dark:hover:bg-amber-900/30',
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
            <ClipboardList className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {t('banner.notCounted')}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t('banner.periodNotCounted', { date: dateLabel, count: state.totalProducts })}
            </p>
          </div>
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
            {t('banner.countNow')} &rarr;
          </span>
        </a>
        {state.supplementary > 0 && <SupplementaryAlert count={state.supplementary} />}
      </div>
    );
  }

  if (state.type === 'counting') {
    const isComplete = state.countedItems >= state.totalProducts && state.totalProducts > 0;
    return (
      <div className="space-y-2">
        <a
          href="/stock/daily-check"
          className={cn(
            'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
            isComplete
              ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30'
              : 'border-blue-200 bg-blue-50 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:hover:bg-blue-900/30',
          )}
        >
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
              isComplete
                ? 'bg-emerald-100 dark:bg-emerald-900/40'
                : 'bg-blue-100 dark:bg-blue-900/40',
            )}
          >
            <ClipboardCheck
              className={cn(
                'h-5 w-5',
                isComplete
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-blue-600 dark:text-blue-400',
              )}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'text-sm font-semibold',
                isComplete
                  ? 'text-emerald-800 dark:text-emerald-200'
                  : 'text-blue-800 dark:text-blue-200',
              )}
            >
              {isComplete ? t('banner.countComplete') : t('banner.counting')}
            </p>
            <p
              className={cn(
                'text-xs',
                isComplete
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-blue-600 dark:text-blue-400',
              )}
            >
              {t('banner.periodCounted', { date: dateLabel, counted: state.countedItems, total: state.totalProducts })}
            </p>
          </div>
          <span
            className={cn(
              'text-xs font-medium',
              isComplete
                ? 'text-emerald-700 dark:text-emerald-300'
                : 'text-blue-700 dark:text-blue-300',
            )}
          >
            {t('banner.viewDetails')} &rarr;
          </span>
        </a>
      </div>
    );
  }

  // state.type === 'compared'
  // Stack the relevant follow-ups (supplementary / explain / approve)
  // under a status header that reflects "compared" — not "counting" —
  // so the user knows the heavy lifting is done and what's left is
  // resolving the variance flow.
  const allClear =
    state.supplementary === 0 &&
    state.pendingExplanation === 0 &&
    state.pendingApproval === 0;

  return (
    <div className="space-y-2">
      <a
        href={`/stock/comparison?date=${businessDate}`}
        className={cn(
          'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
          allClear
            ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30'
            : 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/30',
        )}
      >
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            allClear
              ? 'bg-emerald-100 dark:bg-emerald-900/40'
              : 'bg-indigo-100 dark:bg-indigo-900/40',
          )}
        >
          {allClear ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <ClipboardCheck className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-sm font-semibold',
              allClear
                ? 'text-emerald-800 dark:text-emerald-200'
                : 'text-indigo-800 dark:text-indigo-200',
            )}
          >
            {allClear ? t('banner.allDone') : t('banner.compared')}
          </p>
          <p
            className={cn(
              'text-xs',
              allClear
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-indigo-600 dark:text-indigo-400',
            )}
          >
            {t('banner.periodCompared', {
              date: dateLabel,
              counted: state.countedItems,
              total: state.totalProducts,
            })}
          </p>
        </div>
        <span
          className={cn(
            'text-xs font-medium',
            allClear
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-indigo-700 dark:text-indigo-300',
          )}
        >
          {t('banner.viewDetails')} &rarr;
        </span>
      </a>
      {state.supplementary > 0 && <SupplementaryAlert count={state.supplementary} />}
      {state.pendingExplanation > 0 && (
        <ExplanationAlert count={state.pendingExplanation} />
      )}
      {state.pendingApproval > 0 && (
        <ApprovalAlert count={state.pendingApproval} />
      )}
    </div>
  );
}

/**
 * Compact alert that surfaces POS-only items the staff still need to
 * count. Click-through goes to /stock/daily-check where the dedicated
 * supplementary section lets the bar fill them in.
 */
function SupplementaryAlert({ count }: { count: number }) {
  const t = useTranslations('stock');
  return (
    <a
      href="/stock/daily-check"
      className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:hover:bg-red-900/30"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
        <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-red-800 dark:text-red-200">
          {t('banner.supplementaryTitle', { count })}
        </p>
        <p className="text-xs text-red-600 dark:text-red-400">
          {t('banner.supplementaryHint')}
        </p>
      </div>
      <span className="text-xs font-medium text-red-700 dark:text-red-300">
        {t('banner.countNow')} &rarr;
      </span>
    </a>
  );
}

function ExplanationAlert({ count }: { count: number }) {
  const t = useTranslations('stock');
  return (
    <a
      href="/stock/explanation"
      className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:hover:bg-amber-900/30"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
        <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
          {t('banner.explanationTitle', { count })}
        </p>
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t('banner.explanationHint')}
        </p>
      </div>
      <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
        {t('banner.viewDetails')} &rarr;
      </span>
    </a>
  );
}

function ApprovalAlert({ count }: { count: number }) {
  const t = useTranslations('stock');
  return (
    <a
      href="/stock/approval"
      className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 transition-colors hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-900/20 dark:hover:bg-violet-900/30"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
        <ClipboardList className="h-5 w-5 text-violet-600 dark:text-violet-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-violet-800 dark:text-violet-200">
          {t('banner.approvalTitle', { count })}
        </p>
        <p className="text-xs text-violet-600 dark:text-violet-400">
          {t('banner.approvalHint')}
        </p>
      </div>
      <span className="text-xs font-medium text-violet-700 dark:text-violet-300">
        {t('banner.viewDetails')} &rarr;
      </span>
    </a>
  );
}
