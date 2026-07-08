'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, Badge, toast } from '@/components/ui';
import { useAppStore } from '@/stores/app-store';
import { CalendarDays, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useTranslations } from 'next-intl';
import { formatThaiDate } from '@/lib/utils/format';
import type { CommissionEntry } from '@/types/commission';

function formatCurrency(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface DailyRow {
  date: string;
  ae_net: number;
  ae_count: number;
  bottle_net: number;
  bottle_count: number;
  total_net: number;
  entry_count: number;
  entries: CommissionEntry[];
}

interface CommissionDailySummaryProps {
  month: string;
  refreshKey?: number;
}

export function CommissionDailySummary({ month, refreshKey }: CommissionDailySummaryProps) {
  const t = useTranslations('commission');
  const { currentStoreId } = useAppStore();
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchDaily = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ month });
      if (currentStoreId) params.set('store_id', currentStoreId);
      const res = await fetch(`/api/commission/summary?${params}`);
      if (res.ok) {
        const json = await res.json();
        setDaily(json.daily || []);
      } else {
        toast({ type: 'error', title: t('payment.error') });
      }
    } finally {
      setLoading(false);
    }
  }, [month, currentStoreId, t]);

  // refreshKey is intentionally part of the dep array so a new bill
  // recorded elsewhere refreshes the daily totals.
  useEffect(() => { fetchDaily(); }, [fetchDaily, refreshKey]);

  const monthTotal = daily.reduce((s, d) => s + d.total_net, 0);
  const monthAE = daily.reduce((s, d) => s + d.ae_net, 0);
  const monthBottle = daily.reduce((s, d) => s + d.bottle_net, 0);

  const toggle = (date: string) =>
    setExpanded((prev) => ({ ...prev, [date]: !prev[date] }));

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Month roll-up so the daily list has context */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">AE</p>
            <p className="text-base font-bold text-amber-600 dark:text-amber-400">{formatCurrency(monthAE)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Bottle</p>
            <p className="text-base font-bold text-rose-600 dark:text-rose-400">{formatCurrency(monthBottle)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('daily.monthTotal')}</p>
            <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(monthTotal)}</p>
          </CardContent>
        </Card>
      </div>

      <Card padding="none">
        <CardHeader title={t('daily.title')} />
        {daily.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">{t('daily.noData')}</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {/* Column header (hidden on mobile — the row is self-labelling) */}
            <div className="hidden grid-cols-12 gap-2 px-4 py-2 text-[11px] font-medium text-gray-400 md:grid">
              <span className="col-span-4">{t('daily.colDate')}</span>
              <span className="col-span-2 text-right">AE</span>
              <span className="col-span-2 text-right">Bottle</span>
              <span className="col-span-3 text-right">{t('daily.colTotal')}</span>
              <span className="col-span-1" />
            </div>

            {daily.map((d) => {
              const isOpen = !!expanded[d.date];
              return (
                <div key={d.date}>
                  <button
                    type="button"
                    onClick={() => toggle(d.date)}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                    )}
                    <div className="grid flex-1 grid-cols-2 items-center gap-x-2 gap-y-1 md:grid-cols-12">
                      <div className="col-span-2 flex items-center gap-2 md:col-span-4">
                        <CalendarDays className="h-4 w-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{formatThaiDate(d.date)}</span>
                        <span className="text-xs text-gray-400">
                          {t('daily.entriesCount', { count: d.entry_count })}
                        </span>
                      </div>
                      <span className="text-right text-xs text-amber-600 dark:text-amber-400 md:col-span-2">
                        {d.ae_net > 0 ? formatCurrency(d.ae_net) : '—'}
                      </span>
                      <span className="text-right text-xs text-rose-600 dark:text-rose-400 md:col-span-2">
                        {d.bottle_net > 0 ? formatCurrency(d.bottle_net) : '—'}
                      </span>
                      <span className="col-span-2 text-right text-sm font-bold text-emerald-600 dark:text-emerald-400 md:col-span-3">
                        {formatCurrency(d.total_net)}
                      </span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="space-y-1 bg-gray-50/60 px-4 pb-3 pt-1 dark:bg-gray-900/30">
                      {d.entries.map((e) => {
                        const isAE = e.type === 'ae_commission';
                        const name = isAE
                          ? e.ae_profile?.name || 'Unknown AE'
                          : e.staff_profile?.display_name || e.staff_profile?.username || t('entryList.unspecifiedStaff');
                        return (
                          <div key={e.id} className="flex items-start justify-between gap-2 py-1 pl-6 text-xs">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant={isAE ? 'warning' : 'danger'} size="sm">{isAE ? 'AE' : 'Bottle'}</Badge>
                                <span className="truncate font-medium text-gray-700 dark:text-gray-300">{name}</span>
                                {e.receipt_no && <span className="font-mono text-gray-400">#{e.receipt_no}</span>}
                                {isAE && e.subtotal_amount != null && (
                                  <span className="text-gray-400">
                                    {t('entryList.subtotal')} {formatCurrency(Number(e.subtotal_amount))}
                                  </span>
                                )}
                                {!isAE && e.bottle_count != null && (
                                  <span className="text-gray-400">{e.bottle_count} {t('entryList.bottles')}</span>
                                )}
                              </div>
                              {e.notes && (
                                <p className="mt-0.5 truncate text-gray-400" title={e.notes}>{t('entryList.note')}: {e.notes}</p>
                              )}
                            </div>
                            <span className={cn('shrink-0 font-semibold', isAE ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400')}>
                              {formatCurrency(Number(e.net_amount))}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
