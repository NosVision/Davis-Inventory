'use client';

import { useTranslations } from 'next-intl';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import {
  Button,
  Input,
  Card,
  CardHeader,
  CardContent,
  Tabs,
  EmptyState,
  toast,
} from '@/components/ui';
import { formatThaiDate, formatNumber } from '@/lib/utils/format';
import { yesterdayBangkok } from '@/lib/utils/date';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit';
import {
  runAutoCompare,
  type AutoCompareResult,
} from '@/lib/stock/auto-compare';
import type { Product } from '@/types/database';
import {
  Search,
  Save,
  Package,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  RotateCcw,
  AlertTriangle,
  ArrowRight,
  Info,
} from 'lucide-react';

interface CountEntry {
  product_code: string;
  count_quantity: number | '';
  notes: string;
}

// hq added 2026-07-23 (client report: HQ opened the stock menu but this page bounced them —
// the module registry, RLS, and can_count_stock all already allowed hq; only this list didn't).
const COUNT_ROLES = ['owner', 'accountant', 'manager', 'bar', 'head_bar', 'hq'];

export default function DailyCheckPage() {
  const t = useTranslations('stock');
  const { user } = useAuthStore();

  // Role guard — เฉพาะ staff/bar/manager/owner
  if (user && !COUNT_ROLES.includes(user.role)) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <Package className="h-10 w-10 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('dailyCheck.noPermission')}</p>
        <a href="/stock" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">{t('dailyCheck.backToStock')}</a>
      </div>
    );
  }
  const { currentStoreId } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [counts, setCounts] = useState<Record<string, CountEntry>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [existingCounts, setExistingCounts] = useState<Record<string, number>>(
    {},
  );
  const [showZeroConfirm, setShowZeroConfirm] = useState(false);
  // Per-item saving / saved indicators were tied to the auto-save-on-blur
  // path that we removed; the bottom-right batch save now drives a single
  // global spinner on its own button instead.
  // Product codes that already have a comparison row for the current
  // business date. Once a comparison exists for an item, editing the
  // count silently desyncs it from any explanation/approval that's
  // already happened on /stock/comparison — so we lock the input.
  const [comparedCodes, setComparedCodes] = useState<Set<string>>(new Set());
  // "Show only items I still need to count" — when on, the product list
  // hides everything that already has a saved manual count so the bar can
  // tunnel-vision on what's left (incl. supplementary POS-only items).
  const [showOnlyUncounted, setShowOnlyUncounted] = useState(false);

  // Auto-compare state
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] =
    useState<AutoCompareResult | null>(null);

  // Persistent "manual count saved" indicator (ไม่หายไปแม้ compare จะยังรอ POS)
  const [countFinalized, setCountFinalized] = useState(false);

  // Supplementary count state
  const [supplementaryItems, setSupplementaryItems] = useState<
    Array<{ product_code: string; product_name: string }>
  >([]);
  const [supplementaryCounts, setSupplementaryCounts] = useState<
    Record<string, { count_quantity: number | ''; notes: string }>
  >({});
  const [savingSupplementary, setSavingSupplementary] = useState(false);

  // Business date = yesterday (bars operate past midnight)
  const businessDate = yesterdayBangkok();

  // Track whether this component triggered the realtime event (skip echo)
  const skipRealtimeRef = useRef<Set<string>>(new Set());

  // Per-item auto-save (upsertSingleCount + handleCountBlur + handleNotesBlur)
  // was removed — bar staff lost edit access the moment they tabbed off
  // after a typo. The bottom-right "บันทึก" button is the only writer
  // now; it batches every dirty row in handleSave below.

  // ── Check for POS items not yet counted (supplementary) ──
  const checkSupplementaryItems = useCallback(
    async (
      storeId: string,
      date: string,
      productCodes: Set<string>,
      manualCodes: Set<string>,
    ) => {
      try {
        const supabase = createClient();

        const { data: ocrLogs } = await supabase
          .from('ocr_logs')
          .select('id')
          .eq('store_id', storeId)
          .eq('upload_date', date)
          .order('created_at', { ascending: false })
          .limit(1);

        if (!ocrLogs || ocrLogs.length === 0) return;

        const { data: ocrItems } = await supabase
          .from('ocr_items')
          .select('product_code, product_name')
          .eq('ocr_log_id', ocrLogs[0].id);

        if (!ocrItems || ocrItems.length === 0) return;

        const { data: activeProducts } = await supabase
          .from('products')
          .select('product_code, product_name')
          .eq('store_id', storeId)
          .eq('active', true)
          .eq('count_status', 'active');

        const activeMap = new Map(
          (activeProducts || []).map((p) => [p.product_code, p.product_name]),
        );
        const alreadyCounted = new Set([...productCodes, ...manualCodes]);

        const seen = new Set<string>();
        const missing: Array<{ product_code: string; product_name: string }> =
          [];

        for (const oi of ocrItems) {
          if (
            oi.product_code &&
            activeMap.has(oi.product_code) &&
            !alreadyCounted.has(oi.product_code) &&
            !seen.has(oi.product_code)
          ) {
            seen.add(oi.product_code);
            missing.push({
              product_code: oi.product_code,
              product_name:
                activeMap.get(oi.product_code) ||
                oi.product_name ||
                oi.product_code,
            });
          }
        }

        if (missing.length > 0) {
          setSupplementaryItems(missing);
          const init: Record<
            string,
            { count_quantity: number | ''; notes: string }
          > = {};
          missing.forEach((m) => {
            init[m.product_code] = { count_quantity: '', notes: '' };
          });
          setSupplementaryCounts(init);
        }
      } catch (error) {
        console.error('Error checking supplementary items:', error);
      }
    },
    [],
  );

  // ── Fetch products and existing counts ──
  const fetchProducts = useCallback(async () => {
    if (!currentStoreId) return;

    setLoading(true);
    try {
      const supabase = createClient();

      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('store_id', currentStoreId)
        .eq('active', true)
        .eq('count_status', 'active')
        .order('category', { ascending: true })
        .order('product_name', { ascending: true });

      if (productError) throw productError;

      setProducts(productData || []);

      const initialCounts: Record<string, CountEntry> = {};
      (productData || []).forEach((p) => {
        initialCounts[p.product_code] = {
          product_code: p.product_code,
          count_quantity: '',
          notes: '',
        };
      });

      const { data: existingData } = await supabase
        .from('manual_counts')
        .select('product_code, count_quantity, notes')
        .eq('store_id', currentStoreId)
        .eq('count_date', businessDate);

      if (existingData && existingData.length > 0) {
        const existingMap: Record<string, number> = {};
        existingData.forEach((ec) => {
          existingMap[ec.product_code] = ec.count_quantity;
          if (initialCounts[ec.product_code]) {
            initialCounts[ec.product_code].count_quantity = ec.count_quantity;
            initialCounts[ec.product_code].notes = ec.notes || '';
          }
        });
        setExistingCounts(existingMap);

        const productCodeSet = new Set(
          (productData || []).map((p) => p.product_code),
        );
        const manualCodeSet = new Set(
          existingData.map((e) => e.product_code),
        );
        await checkSupplementaryItems(
          currentStoreId,
          businessDate,
          productCodeSet,
          manualCodeSet,
        );
      }

      // Check which products already have a comparison row for today.
      const { data: compRows } = await supabase
        .from('comparisons')
        .select('product_code')
        .eq('store_id', currentStoreId)
        .eq('comp_date', businessDate);
      setComparedCodes(
        new Set((compRows || []).map((r) => r.product_code as string)),
      );

      setCounts(initialCounts);
    } catch (error) {
      console.error('Error fetching products:', error);
      toast({
        type: 'error',
        title: t('dailyCheck.errorTitle'),
        message: t('dailyCheck.errorLoadProducts'),
      });
    } finally {
      setLoading(false);
    }
  }, [currentStoreId, businessDate, checkSupplementaryItems]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // ── Realtime subscription: see other staff's updates live ──
  useEffect(() => {
    if (!currentStoreId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`manual-counts-${currentStoreId}-${businessDate}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'manual_counts',
          filter: `store_id=eq.${currentStoreId}`,
        },
        (payload) => {
          if (
            payload.eventType === 'INSERT' ||
            payload.eventType === 'UPDATE'
          ) {
            const record = payload.new as {
              product_code: string;
              count_quantity: number;
              notes: string | null;
              count_date: string;
            };
            if (record.count_date !== businessDate) return;

            // Skip echo from our own saves
            if (skipRealtimeRef.current.has(record.product_code)) return;

            setCounts((prev) => {
              if (!prev[record.product_code]) return prev;
              return {
                ...prev,
                [record.product_code]: {
                  ...prev[record.product_code],
                  count_quantity: record.count_quantity,
                  notes: record.notes || '',
                },
              };
            });

            setExistingCounts((prev) => ({
              ...prev,
              [record.product_code]: record.count_quantity,
            }));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentStoreId, businessDate]);

  // ── Category tabs ──
  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    const tabs = [{ id: 'all', label: t('dailyCheck.allCategories'), count: products.length }];
    Array.from(cats)
      .sort()
      .forEach((cat) => {
        tabs.push({
          id: cat,
          label: cat,
          count: products.filter((p) => p.category === cat).length,
        });
      });
    return tabs;
  }, [products]);

  // ── Filtered products ──
  const filteredProducts = useMemo(() => {
    let filtered = products;
    if (activeCategory !== 'all') {
      filtered = filtered.filter((p) => p.category === activeCategory);
    }
    if (showOnlyUncounted) {
      filtered = filtered.filter(
        (p) => existingCounts[p.product_code] === undefined,
      );
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.product_name.toLowerCase().includes(query) ||
          p.product_code.toLowerCase().includes(query),
      );
    }
    return filtered;
  }, [products, activeCategory, searchQuery, showOnlyUncounted, existingCounts]);

  // Items the user still has to count: regular products without a saved
  // manual_count + the supplementary POS-only items we surfaced.
  const remainingCount = useMemo(() => {
    const uncountedProducts = products.filter(
      (p) => existingCounts[p.product_code] === undefined,
    ).length;
    return uncountedProducts + supplementaryItems.length;
  }, [products, existingCounts, supplementaryItems]);

  // Bar role can record fresh counts but must not overwrite a count that
  // someone (incl. themselves) already saved for the day — keeps the
  // closing audit trail clean. Owners / managers / accountants can edit.
  const isBar = user?.role === 'bar' || user?.role === 'head_bar';

  // ── Handlers ──
  const handleCountChange = (productCode: string, value: string) => {
    setCounts((prev) => ({
      ...prev,
      [productCode]: {
        ...prev[productCode],
        count_quantity: value === '' ? '' : Number(value),
      },
    }));
  };

  const handleNotesChange = (productCode: string, value: string) => {
    setCounts((prev) => ({
      ...prev,
      [productCode]: {
        ...prev[productCode],
        notes: value,
      },
    }));
  };

  // ── Finalize save: validate + batch upsert + auto-compare ──
  const doSave = async () => {
    if (!currentStoreId || !user) return;

    const entries = Object.values(counts).filter(
      (c) => c.count_quantity !== '' && c.count_quantity !== undefined,
    );

    setSaving(true);
    setShowZeroConfirm(false);
    try {
      const supabase = createClient();

      // Batch upsert all items (catches any not yet saved via blur)
      const upsertData = entries.map((entry) => ({
        store_id: currentStoreId,
        count_date: businessDate,
        product_code: entry.product_code,
        count_quantity: Number(entry.count_quantity),
        user_id: user.id,
        notes: entry.notes || null,
        verified: false,
      }));

      if (upsertData.length > 0) {
        const { error } = await supabase
          .from('manual_counts')
          .upsert(upsertData, {
            onConflict: 'store_id,count_date,product_code',
          });

        if (error) throw error;
      }

      await logAudit({
        store_id: currentStoreId,
        action_type: AUDIT_ACTIONS.STOCK_COUNT_SAVED,
        table_name: 'manual_counts',
        new_value: {
          count_date: businessDate,
          items_count: entries.length,
          type: 'batch_finalize',
          products: entries.slice(0, 10).map((e) => {
            const p = products.find((pr) => pr.product_code === e.product_code);
            return p?.product_name || e.product_code;
          }),
        },
        changed_by: user.id,
      });

      toast({
        type: 'success',
        title: t('dailyCheck.saveSuccess'),
        message: t('dailyCheck.saveCountMsg', { count: entries.length }),
      });

      // Update existing counts state
      const newExisting: Record<string, number> = {};
      entries.forEach((e) => {
        newExisting[e.product_code] = Number(e.count_quantity);
      });
      setExistingCounts(newExisting);
      setCountFinalized(true);

      // ── Auto-compare ──
      setComparing(true);
      try {
        const result = await runAutoCompare(currentStoreId, businessDate);
        setCompareResult(result);

        if (result.compared) {
          // Refresh the locked-codes set so the inputs immediately
          // become read-only without a page reload.
          const { data: compRows } = await supabase
            .from('comparisons')
            .select('product_code')
            .eq('store_id', currentStoreId)
            .eq('comp_date', businessDate);
          setComparedCodes(
            new Set((compRows || []).map((r) => r.product_code as string)),
          );

          toast({
            type: 'success',
            title: t('dailyCheck.autoCompareSuccess'),
            message: t('dailyCheck.autoCompareMsg', { match: result.summary?.match || 0, overTolerance: result.summary?.over_tolerance || 0 }),
          });
        } else if (result.reason === 'no_pos') {
          toast({
            type: 'info',
            title: t('dailyCheck.waitingPosTitle'),
            message: t('dailyCheck.waitingPosMsg'),
          });
        }

        if (result.missingItems && result.missingItems.length > 0) {
          setSupplementaryItems(result.missingItems);
          const init: Record<
            string,
            { count_quantity: number | ''; notes: string }
          > = {};
          result.missingItems.forEach((item) => {
            init[item.product_code] = { count_quantity: '', notes: '' };
          });
          setSupplementaryCounts(init);
        }
      } catch (err) {
        console.error('Auto-compare error:', err);
        toast({
          type: 'warning',
          title: t('dailyCheck.autoCompareFailed'),
          message: t('dailyCheck.autoCompareFailedMsg'),
        });
      } finally {
        setComparing(false);
      }
    } catch (error) {
      console.error('Error saving counts:', error);
      toast({
        type: 'error',
        title: t('dailyCheck.errorTitle'),
        message: t('dailyCheck.errorSaveCounts'),
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Save button validation wrapper ──
  const handleSave = async () => {
    if (!currentStoreId || !user) return;

    const unfilledCount = Object.values(counts).filter(
      (c) => c.count_quantity === '' || c.count_quantity === undefined,
    ).length;

    if (unfilledCount > 0) {
      toast({
        type: 'warning',
        title: t('dailyCheck.fillAllItems'),
        message: t('dailyCheck.unfilledCount', { count: unfilledCount }),
      });
      return;
    }

    const zeroCount = Object.values(counts).filter(
      (c) => c.count_quantity === 0,
    ).length;

    if (zeroCount > 0) {
      setShowZeroConfirm(true);
      return;
    }

    await doSave();
  };

  // ── Save supplementary counts ──
  const handleSaveSupplementary = async () => {
    if (!currentStoreId || !user) return;

    const entries = Object.entries(supplementaryCounts)
      .filter(
        ([, v]) => v.count_quantity !== '' && v.count_quantity !== undefined,
      )
      .map(([code, v]) => ({
        store_id: currentStoreId,
        count_date: businessDate,
        product_code: code,
        count_quantity: Number(v.count_quantity),
        user_id: user.id,
        notes: v.notes || null,
        verified: false,
      }));

    if (entries.length === 0) {
      toast({
        type: 'warning',
        title: t('dailyCheck.noData'),
        message: t('dailyCheck.fillSupplementaryMsg'),
      });
      return;
    }

    const unfilledSup = supplementaryItems.length - entries.length;
    if (unfilledSup > 0) {
      toast({
        type: 'warning',
        title: t('dailyCheck.fillAllItems'),
        message: t('dailyCheck.unfilledSupplementary', { count: unfilledSup }),
      });
      return;
    }

    setSavingSupplementary(true);
    try {
      const supabase = createClient();

      const { error } = await supabase
        .from('manual_counts')
        .upsert(entries, {
          onConflict: 'store_id,count_date,product_code',
        });

      if (error) throw error;

      await logAudit({
        store_id: currentStoreId,
        action_type: AUDIT_ACTIONS.STOCK_COUNT_SAVED,
        table_name: 'manual_counts',
        new_value: {
          count_date: businessDate,
          items_count: entries.length,
          type: 'supplementary',
          products: supplementaryItems.slice(0, 10).map((s) => s.product_name || s.product_code),
        },
        changed_by: user.id,
      });

      toast({
        type: 'success',
        title: t('dailyCheck.saveSupplementarySuccess'),
        message: t('dailyCheck.saveSupplementaryMsg', { count: entries.length }),
      });

      setSupplementaryItems([]);
      setSupplementaryCounts({});

      // Re-run auto-compare so the new manual counts are reflected in
      // /stock/comparison + /stock/explanation (supplementary items
      // would otherwise stay flagged as POS-only). Surface the result
      // explicitly — silent compare here used to confuse users into
      // thinking nothing happened.
      try {
        const result = await runAutoCompare(currentStoreId, businessDate);
        setCompareResult(result);
        if (result.compared) {
          const { data: compRows } = await supabase
            .from('comparisons')
            .select('product_code')
            .eq('store_id', currentStoreId)
            .eq('comp_date', businessDate);
          setComparedCodes(
            new Set((compRows || []).map((r) => r.product_code as string)),
          );
          toast({
            type: 'success',
            title: t('dailyCheck.autoCompareSuccess'),
            message: t('dailyCheck.autoCompareMsg', {
              match: result.summary?.match || 0,
              overTolerance: result.summary?.over_tolerance || 0,
            }),
          });
        } else if (result.reason === 'no_pos') {
          toast({
            type: 'info',
            title: t('dailyCheck.waitingPosTitle'),
            message: t('dailyCheck.waitingPosMsg'),
          });
        }
      } catch (err) {
        console.error('Auto-compare after supplementary save failed:', err);
        toast({
          type: 'warning',
          title: t('dailyCheck.autoCompareFailed'),
          message: t('dailyCheck.autoCompareFailedMsg'),
        });
      }
    } catch (error) {
      console.error('Error saving supplementary counts:', error);
      toast({
        type: 'error',
        title: t('dailyCheck.errorTitle'),
        message: t('dailyCheck.errorSaveSupplementary'),
      });
    } finally {
      setSavingSupplementary(false);
    }
  };

  // ── Reset ──
  const handleReset = () => {
    const resetCounts: Record<string, CountEntry> = {};
    products.forEach((p) => {
      resetCounts[p.product_code] = {
        product_code: p.product_code,
        count_quantity: '',
        notes: '',
      };
    });
    setCounts(resetCounts);
  };

  // ── Computed ──
  const filledCount = Object.values(counts).filter(
    (c) => c.count_quantity !== '' && c.count_quantity !== undefined,
  ).length;

  const zeroQtyCount = Object.values(counts).filter(
    (c) => c.count_quantity === 0,
  ).length;

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <a
              href="/stock"
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            >
              <ArrowLeft className="h-5 w-5" />
            </a>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              {t('dailyCheck.title')}
            </h1>
          </div>
          <p className="mt-0.5 ml-9 text-sm text-gray-500 dark:text-gray-400">
            {formatThaiDate(businessDate)} — {t('dailyCheck.countedProgress', { filled: filledCount, total: products.length })}
          </p>
        </div>
      </div>

      {/* Business date info */}
      <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span>
          {t('dailyCheck.countDateLabel')}: <strong>{formatThaiDate(businessDate)}</strong>{' '}
          {t('dailyCheck.countDateInfo')}
        </span>
      </div>

      {/* Locked-after-compare banner — same indigo "เปรียบเทียบแล้ว"
          treatment as the /stock summary banner so the user reads the
          two pages as a single state, not two visually unrelated
          notices. */}
      {comparedCodes.size > 0 && (
        <a
          href={`/stock/comparison?date=${businessDate}`}
          className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/30"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40">
            <CheckCircle2 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">
              {t('dailyCheck.lockedComparedBannerTitle')}
            </p>
            <p className="mt-0.5 text-xs text-indigo-600 dark:text-indigo-400">
              {t('dailyCheck.lockedComparedBannerHint')}
            </p>
          </div>
          <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-indigo-700 sm:inline-flex dark:text-indigo-300">
            {t('dailyCheck.lockedComparedBannerCta')}
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </a>
      )}

      {/* "ต้องนับเพิ่ม" prominent counter — opens with a one-tap filter
          to hide everything that's already saved. */}
      {remainingCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {t('dailyCheck.remainingTitle', { count: remainingCount })}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('dailyCheck.remainingHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowOnlyUncounted((v) => !v)}
            className={cn(
              'shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              showOnlyUncounted
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-white text-amber-700 ring-1 ring-amber-300 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700',
            )}
          >
            {showOnlyUncounted
              ? t('dailyCheck.showAll')
              : t('dailyCheck.showRemainingOnly')}
          </button>
        </div>
      )}

      {/* ── Supplementary Count Section (ด้านบนสุด — ต้องนับเพิ่ม) ── */}
      {supplementaryItems.length > 0 && (
        <Card>
          <CardHeader
            title={t('dailyCheck.supplementaryTitle', { count: supplementaryItems.length })}
          />
          <CardContent>
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <p className="text-xs text-red-700 dark:text-red-400">
                {t('dailyCheck.supplementaryWarning', { count: supplementaryItems.length })}
              </p>
            </div>
            <div className="space-y-2">
              {supplementaryItems.map((item) => (
                <div
                  key={item.product_code}
                  className="flex items-center gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {item.product_name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {item.product_code}
                    </p>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    value={
                      supplementaryCounts[item.product_code]?.count_quantity ??
                      ''
                    }
                    onChange={(e) =>
                      setSupplementaryCounts((prev) => ({
                        ...prev,
                        [item.product_code]: {
                          ...prev[item.product_code],
                          count_quantity:
                            e.target.value === ''
                              ? ''
                              : Number(e.target.value),
                        },
                      }))
                    }
                    className="w-20 rounded-lg border border-gray-300 bg-white px-3 py-2 text-center text-sm font-medium outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                size="sm"
                icon={<Save className="h-4 w-4" />}
                isLoading={savingSupplementary}
                onClick={handleSaveSupplementary}
              >
                {t('dailyCheck.saveSupplementary')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Persistent "manual count saved" banner — คงไว้แม้ compare จะยังรอ POS */}
      {countFinalized && !comparing && !compareResult?.compared && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                {t('dailyCheck.countFinalized')}
              </p>
              <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                {compareResult?.reason === 'no_pos'
                  ? t('dailyCheck.waitingPosMsg')
                  : t('dailyCheck.countFinalizedHint')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Auto-compare in progress */}
      {comparing && (
        <div className="flex items-center gap-2 rounded-xl bg-indigo-50 p-4 dark:bg-indigo-900/20">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-600 dark:text-indigo-400" />
          <span className="text-sm text-indigo-700 dark:text-indigo-300">
            {t('dailyCheck.autoComparing')}
          </span>
        </div>
      )}

      {/* Auto-compare result banner */}
      {compareResult?.compared && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                {t('dailyCheck.autoCompareComplete')}
              </p>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-emerald-700 dark:text-emerald-400">
                <span>{t('dailyCheck.match')} {compareResult.summary?.match || 0}</span>
                <span>
                  {t('dailyCheck.withinTolerance')} {compareResult.summary?.within_tolerance || 0}
                </span>
                {(compareResult.summary?.over_tolerance || 0) > 0 && (
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {t('dailyCheck.overTolerance')} {compareResult.summary?.over_tolerance}
                  </span>
                )}
              </div>
              <a
                href="/stock/comparison"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
              >
                {t('dailyCheck.viewComparison')}
                <ArrowRight className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Zero qty confirmation */}
      {showZeroConfirm && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {t('dailyCheck.zeroQtyWarning', { count: zeroQtyCount })}
              </p>
              <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                {t('dailyCheck.zeroQtyConfirmMsg')}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowZeroConfirm(false)}
                >
                  {t('dailyCheck.goBackEdit')}
                </Button>
                <Button size="sm" onClick={doSave} isLoading={saving}>
                  {t('dailyCheck.confirmSave')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <Input
        placeholder={t('dailyCheck.searchProduct')}
        leftIcon={<Search className="h-4 w-4" />}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      {/* Category Tabs */}
      {categories.length > 1 && (
        <Tabs
          tabs={categories}
          activeTab={activeCategory}
          onChange={setActiveCategory}
        />
      )}

      {/* Product Count List */}
      {filteredProducts.length === 0 ? (
        <EmptyState
          icon={Package}
          title={t('dailyCheck.noProductFound')}
          description={
            searchQuery
              ? t('dailyCheck.tryDifferentSearch')
              : t('dailyCheck.noProductsInSystem')
          }
        />
      ) : (
        <div className="space-y-2">
          {filteredProducts.map((product) => {
            const entry = counts[product.product_code];
            const hasExisting =
              existingCounts[product.product_code] !== undefined;
            const isFilled =
              entry?.count_quantity !== '' &&
              entry?.count_quantity !== undefined;
            const isZero = entry?.count_quantity === 0;
            // Per-item save indicators retired with auto-save-on-blur.
            // Two reasons we'd lock an input:
            //   1. Bar staff editing a count that's already been saved
            //      for the day — only owners/managers/accountants can
            //      revise an existing count.
            //   2. The item already has a comparison row, regardless of
            //      role — editing here would silently desync from any
            //      explanation/approval already on /stock/comparison.
            const lockedForBar = isBar && hasExisting;
            const lockedAfterCompare = comparedCodes.has(product.product_code) && hasExisting;
            const locked = lockedForBar || lockedAfterCompare;
            const lockReasonKey = lockedAfterCompare
              ? 'dailyCheck.lockedCompared'
              : 'dailyCheck.lockedSaved';

            return (
              <div
                key={product.id}
                className={cn(
                  'rounded-xl bg-white p-4 shadow-sm ring-1 transition-colors dark:bg-gray-800',
                  locked ? 'opacity-75' : '',
                  isZero
                    ? 'ring-amber-300 dark:ring-amber-700'
                    : isFilled
                      ? 'ring-emerald-200 dark:ring-emerald-800'
                      : 'ring-gray-200 dark:ring-gray-700',
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Product Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {product.product_name}
                      </p>
                      {hasExisting && (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                      )}
                      {isZero && (
                        <span
                          title={t('dailyCheck.zeroQtyIconTooltip')}
                          aria-label={t('dailyCheck.zeroQtyIconTooltip')}
                          className="inline-flex"
                        >
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-400 dark:text-gray-500">
                      <span>{product.product_code}</span>
                      {product.category && <span>{product.category}</span>}
                      {product.size && <span>{product.size}</span>}
                      {product.unit && <span>({product.unit})</span>}
                      {locked && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                          {t(lockReasonKey)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Count Input */}
                  <div className="flex shrink-0 items-center gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="0"
                      value={entry?.count_quantity ?? ''}
                      readOnly={locked}
                      disabled={locked}
                      onChange={(e) =>
                        handleCountChange(product.product_code, e.target.value)
                      }
                      // No more auto-save on blur — caused bar staff to lose
                      // edit access the moment they tabbed off after a typo.
                      // The bottom-right "บันทึก" button is now the only writer.
                      className={cn(
                        'w-20 rounded-lg border bg-white px-3 py-2 text-center text-sm font-medium outline-none transition-colors',
                        'focus:ring-2 focus:ring-offset-0',
                        'dark:bg-gray-800 dark:text-white',
                        locked
                          ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-500 dark:border-gray-700 dark:bg-gray-700/50 dark:text-gray-400'
                          : isZero
                            ? 'border-amber-300 focus:border-amber-500 focus:ring-amber-500/20 dark:border-amber-700'
                            : isFilled
                              ? 'border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500/20 dark:border-emerald-700'
                              : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-500/20 dark:border-gray-600',
                      )}
                    />
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {product.unit || t('dailyCheck.defaultUnit')}
                    </span>
                  </div>
                </div>

                {/* Notes input (shown when count is filled) */}
                {isFilled && (
                  <div className="mt-3">
                    <input
                      type="text"
                      placeholder={t('dailyCheck.notesPlaceholder')}
                      value={entry?.notes || ''}
                      readOnly={locked}
                      disabled={locked}
                      onChange={(e) =>
                        handleNotesChange(product.product_code, e.target.value)
                      }
                      // Notes are saved together with the count on the
                      // bottom-right "บันทึก" press — see comment on the
                      // qty input above.
                      className={cn(
                        'w-full rounded-lg border bg-gray-50 px-3 py-1.5 text-xs outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 dark:bg-gray-700 dark:placeholder:text-gray-500',
                        locked
                          ? 'cursor-not-allowed border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'
                          : 'border-gray-200 text-gray-700 dark:border-gray-600 dark:text-gray-300',
                      )}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom Action Bar */}
      {products.length > 0 && (
        <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-white/95 px-4 py-4 backdrop-blur-sm dark:border-gray-700 dark:bg-gray-900/95 sm:-mx-6 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              <span className="font-medium text-gray-900 dark:text-white">
                {filledCount}
              </span>{' '}
              / {products.length} {t('dailyCheck.itemsLabel')}
              {zeroQtyCount > 0 && (
                <span
                  className="ml-2 text-amber-500"
                  title={t('dailyCheck.zeroQtyIconTooltip')}
                >
                  ({t('dailyCheck.zeroQtyCounter', { count: zeroQtyCount })})
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                icon={<RotateCcw className="h-4 w-4" />}
                onClick={handleReset}
              >
                {t('dailyCheck.reset')}
              </Button>
              <Button
                size="sm"
                icon={<Save className="h-4 w-4" />}
                isLoading={saving || comparing}
                onClick={handleSave}
              >
                {t('dailyCheck.finish', { filled: filledCount, total: products.length })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
