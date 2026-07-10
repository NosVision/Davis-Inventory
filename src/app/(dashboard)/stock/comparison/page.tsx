'use client';

import { useTranslations } from 'next-intl';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { Button, Input, Badge, Card, CardHeader, Tabs, EmptyState, toast, Modal } from '@/components/ui';
import { nowBangkok } from '@/lib/utils/date';
import { formatThaiDate, formatPercent, formatQty, formatSignedQty } from '@/lib/utils/format';
import { isWithinToleranceFor } from '@/lib/stock/variance';
import type { Comparison, ComparisonStatus } from '@/types/database';
import {
  ArrowLeft,
  Search,
  Calendar,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  FileText,
  Loader2,
  TrendingDown,
  TrendingUp,
  Minus,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Check,
  X,
} from 'lucide-react';

// Roles that may NOT override the "นับจริง" cell from this page —
// staff/bar count via /stock/daily-check; only manager+ may correct
// after the fact (request from owner: "ทุก role ยกเว้น staff/bar").
const READ_ONLY_ROLES = new Set(['staff', 'bar', 'head_bar']);

// Default tolerance used when store_settings hasn't been read yet —
// matches the constants below so the first paint doesn't show a row in
// a different tone than after settings load. Server-side compare API
// has its own copy; keep both in sync.
const DEFAULT_TOLERANCE = { percent: 5, unit: 0.4 };

// Recompute difference + diff_percent + status the same way the
// /api/stock/compare server route does, so an inline edit stays
// consistent with what a fresh compare would produce.
function deriveComparisonFields(
  manual: number | null,
  pos: number | null,
  tolerance: { percent: number; unit: number },
): { difference: number | null; diff_percent: number | null; status: ComparisonStatus } {
  // POS-only → still "pending" (staff hasn't counted yet).
  if (pos !== null && manual === null) {
    return { difference: 0 - pos, diff_percent: pos === 0 ? 0 : -100, status: 'pending' };
  }
  // Manual-only → auto-approve (no POS line means no expectation).
  if (manual !== null && pos === null) {
    return { difference: null, diff_percent: null, status: 'approved' };
  }
  if (manual === null || pos === null) {
    return { difference: null, diff_percent: null, status: 'approved' };
  }

  let difference: number = manual - pos;
  let diffPercent: number;
  if (Math.abs(difference) < 0.005) {
    difference = 0;
    diffPercent = 0;
  } else if (pos !== 0) {
    diffPercent = (difference / pos) * 100;
  } else {
    diffPercent = manual > 0 ? 100 : -100;
  }
  // Clamp to numeric(10,2) range.
  diffPercent = Math.max(-99999999.99, Math.min(99999999.99, Math.round(diffPercent * 100) / 100));

  let status: ComparisonStatus;
  if (difference === 0) {
    status = 'approved';
  } else if (
    isWithinToleranceFor({
      manual,
      pos,
      difference,
      diffPercent,
      tolerance: { unit: tolerance.unit, percent: tolerance.percent },
    })
  ) {
    status = 'approved';
  } else {
    status = 'pending';
  }

  return { difference, diff_percent: diffPercent, status };
}
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

// 'pending' is split into two UX-only sub-states. The DB still uses
// status='pending' for both — we distinguish them client-side because
// they trigger very different actions:
//   pending_count   → POS exists but manual_quantity is null → go count
//   pending_explain → both sides exist, diff over tolerance  → write an
//                     explanation
type FilterStatus = 'all' | 'pending_count' | 'pending_explain' | 'explained' | 'approved' | 'rejected';

const isPendingCount = (c: { status: ComparisonStatus; manual_quantity: number | null }) =>
  c.status === 'pending' && c.manual_quantity === null;
const isPendingExplain = (c: { status: ComparisonStatus; manual_quantity: number | null }) =>
  c.status === 'pending' && c.manual_quantity !== null;

function getStatusConfig(status: ComparisonStatus, t?: (key: string) => string) {
  switch (status) {
    case 'pending':
      return {
        label: t?.('comparison.statusPending') ?? 'Pending',
        variant: 'warning' as const,
        icon: Clock,
      };
    case 'explained':
      return {
        label: t?.('comparison.statusExplained') ?? 'Explained',
        variant: 'info' as const,
        icon: FileText,
      };
    case 'approved':
      return {
        label: t?.('comparison.statusApproved') ?? 'Approved',
        variant: 'success' as const,
        icon: CheckCircle2,
      };
    case 'rejected':
      return {
        label: t?.('comparison.statusRejected') ?? 'Rejected',
        variant: 'danger' as const,
        icon: XCircle,
      };
  }
}

// Treat anything below the column's 0.01 resolution as an exact match —
// avoids labelling 8.50 vs 8.50 (= 0.000001 due to FP arithmetic) as a
// discrepancy in the colour swatch / hint chip.
const isEffectivelyZero = (n: number | null) =>
  n === null || Math.abs(n) < 0.005;

// A comparison row's four fields the tolerance decision needs. 'auto' mode
// inspects manual+pos (whole integers → bottle stock), so both are required.
type VarianceRow = {
  difference: number | null;
  diff_percent: number | null;
  manual_quantity: number | null;
  pos_quantity: number | null;
};

// The compare API reads per-store tolerances from store_settings; the UI uses
// the shared helper's defaults so the "level" chip + summary stats agree with
// the server's auto-approve rule (and share the same whole-bottle detection).
const isWithinTolerance = (row: VarianceRow) => {
  if (row.difference === null) return false;
  return isWithinToleranceFor({
    manual: row.manual_quantity,
    pos: row.pos_quantity,
    difference: row.difference,
    diffPercent: row.diff_percent,
  });
};

function getDiffColor(row: VarianceRow) {
  if (isEffectivelyZero(row.difference)) {
    return {
      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
      text: 'text-emerald-700 dark:text-emerald-400',
      ring: 'ring-emerald-200 dark:ring-emerald-800',
      labelKey: 'comparison.match',
    };
  }
  if (isWithinTolerance(row)) {
    return {
      bg: 'bg-yellow-50 dark:bg-yellow-900/20',
      text: 'text-yellow-700 dark:text-yellow-400',
      ring: 'ring-yellow-200 dark:ring-yellow-800',
      labelKey: 'comparison.withinTolerance',
    };
  }
  return {
    bg: 'bg-red-50 dark:bg-red-900/20',
    text: 'text-red-700 dark:text-red-400',
    ring: 'ring-red-200 dark:ring-red-800',
    labelKey: 'comparison.overTolerance',
  };
}

interface DayStat {
  date: string;
  total: number;
  match: number;
  withinTolerance: number;
  overTolerance: number;
  pending: number;
  explained: number;
  approved: number;
}

export default function ComparisonPage() {
  const t = useTranslations('stock');
  const { user } = useAuthStore();
  const { currentStoreId } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [selectedDate, setSelectedDate] = useState('');
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = nowBangkok();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [detailDate, setDetailDate] = useState<string | null>(null);
  const [posFileUrl, setPosFileUrl] = useState<string | null>(null);

  // Inline-edit state for the "นับจริง" column.
  // - editingId: which row is being edited (input visible)
  // - editingValue: textbox draft (string so we keep "" + "12." mid-typing)
  // - confirming: row pending confirmation modal acceptance
  // - savingId: optimistic-save spinner gate
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [confirming, setConfirming] = useState<{
    item: Comparison;
    newQty: number;
  } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Per-store tolerance — used by deriveComparisonFields to flip status
  // between approved/pending without a server round-trip.
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);

  const canEditManual = !!user && !READ_ONLY_ROLES.has(user.role);
  // Trend always shows the current calendar month — the week/month toggle
  // was confusing (entering on a fresh week showed an empty state) and the
  // month range gives enough resolution for daily-stock workflows.
  // Per-product cross-day view + bookmarks moved to /stock/tracking — that
  // page is the home for cross-day investigation.

  const fetchComparisons = useCallback(async () => {
    if (!currentStoreId) return;

    setLoading(true);
    try {
      const supabase = createClient();

      // Fetch all comparison dates
      const { data: dateData } = await supabase
        .from('comparisons')
        .select('comp_date')
        .eq('store_id', currentStoreId)
        .order('comp_date', { ascending: false });

      if (dateData) {
        const uniqueDates = [...new Set(dateData.map((d) => d.comp_date))];
        setAvailableDates(uniqueDates);

        // Auto-select date from URL params or latest
        const urlParams = new URLSearchParams(window.location.search);
        const dateParam = urlParams.get('date');
        const targetDate = dateParam && uniqueDates.includes(dateParam)
          ? dateParam
          : uniqueDates[0] || '';
        setSelectedDate(targetDate);
      }

      // Fetch comparisons
      let query = supabase
        .from('comparisons')
        .select('*')
        .eq('store_id', currentStoreId)
        .order('comp_date', { ascending: false })
        .order('product_name', { ascending: true });

      const { data, error } = await query;

      if (error) throw error;
      setComparisons(data || []);
    } catch (error) {
      console.error('Error fetching comparisons:', error);
      toast({
        type: 'error',
        title: t('comparison.errorTitle'),
        message: t('comparison.errorLoadData'),
      });
    } finally {
      setLoading(false);
    }
  }, [currentStoreId]);

  useEffect(() => {
    fetchComparisons();
  }, [fetchComparisons]);

  // Fetch this store's tolerance once per store change so inline
  // recompute uses the same thresholds as the server compare route.
  useEffect(() => {
    if (!currentStoreId) {
      setTolerance(DEFAULT_TOLERANCE);
      return;
    }
    const supabase = createClient();
    supabase
      .from('store_settings')
      .select('diff_tolerance, diff_tolerance_unit')
      .eq('store_id', currentStoreId)
      .maybeSingle()
      .then(({ data }) => {
        setTolerance({
          percent: Number(data?.diff_tolerance ?? DEFAULT_TOLERANCE.percent),
          unit: Number(data?.diff_tolerance_unit ?? DEFAULT_TOLERANCE.unit),
        });
      });
  }, [currentStoreId]);

  const beginEdit = useCallback((item: Comparison) => {
    setEditingId(item.id);
    setEditingValue(
      item.manual_quantity !== null && item.manual_quantity !== undefined
        ? String(item.manual_quantity)
        : '',
    );
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingValue('');
  }, []);

  // Step 1 of save: validate input + open confirm modal. Actual DB write
  // happens in commitSave below — we want a confirm step because manual
  // count is a data-integrity field and a fat-fingered enter shouldn't
  // silently overwrite the staff's count.
  const requestSave = useCallback(
    (item: Comparison) => {
      const trimmed = editingValue.trim();
      if (trimmed === '') {
        toast({ type: 'error', title: 'กรุณาใส่จำนวน' });
        return;
      }
      const newQty = Number(trimmed);
      if (!Number.isFinite(newQty) || newQty < 0) {
        toast({ type: 'error', title: 'ใส่ตัวเลขไม่ถูกต้อง' });
        return;
      }
      // No-op if the value didn't actually change.
      if (newQty === Number(item.manual_quantity ?? NaN)) {
        cancelEdit();
        return;
      }
      setConfirming({ item, newQty });
    },
    [editingValue, cancelEdit],
  );

  // Step 2 of save: write to DB.
  // Updates BOTH:
  //   • manual_counts (upsert) so any future re-run of /api/stock/compare
  //     keeps this corrected number — comparisons row alone would get
  //     overwritten on next compare.
  //   • comparisons row with recomputed difference + diff_percent + status
  //     so the page reflects the change immediately without a refetch.
  const commitSave = useCallback(async () => {
    if (!confirming || !user || !currentStoreId) return;
    const { item, newQty } = confirming;
    setSavingId(item.id);
    const supabase = createClient();

    const derived = deriveComparisonFields(newQty, item.pos_quantity, tolerance);

    // 1. Upsert the canonical manual_counts row.
    const { error: mcError } = await supabase
      .from('manual_counts')
      .upsert(
        {
          store_id: currentStoreId,
          count_date: item.comp_date,
          product_code: item.product_code,
          count_quantity: newQty,
          user_id: user.id,
          notes: 'edited via /stock/comparison',
        },
        { onConflict: 'store_id,count_date,product_code' },
      );
    if (mcError) {
      setSavingId(null);
      toast({ type: 'error', title: 'บันทึก manual_counts ล้มเหลว', message: mcError.message });
      return;
    }

    // 2. Update the comparisons row with the new derived values + reset
    //    explanation/approval state so the row re-enters the normal
    //    explain → approve flow if it now exceeds tolerance.
    const { error: cmpError } = await supabase
      .from('comparisons')
      .update({
        manual_quantity: newQty,
        difference: derived.difference,
        diff_percent: derived.diff_percent,
        status: derived.status,
        // Clear stale explanation/approval — the number changed, the
        // previous explanation no longer describes the new diff.
        explanation: null,
        explained_by: null,
        approval_status: null,
        approved_by: null,
        owner_notes: null,
      })
      .eq('id', item.id);
    setSavingId(null);
    if (cmpError) {
      toast({ type: 'error', title: 'บันทึก comparisons ล้มเหลว', message: cmpError.message });
      return;
    }

    // Local update so UI reflects the change without a refetch.
    setComparisons((prev) =>
      prev.map((c) =>
        c.id === item.id
          ? {
              ...c,
              manual_quantity: newQty,
              difference: derived.difference,
              diff_percent: derived.diff_percent,
              status: derived.status,
              explanation: null,
              explained_by: null,
              approval_status: null,
              approved_by: null,
              owner_notes: null,
            }
          : c,
      ),
    );
    setConfirming(null);
    cancelEdit();
    toast({ type: 'success', title: 'บันทึกแล้ว' });
  }, [confirming, user, currentStoreId, tolerance, cancelEdit]);

  // Fetch POS file URL for the selected date
  useEffect(() => {
    if (!currentStoreId || !selectedDate) {
      setPosFileUrl(null);
      return;
    }
    const supabase = createClient();
    supabase
      .from('ocr_logs')
      .select('file_urls')
      .eq('store_id', currentStoreId)
      .eq('upload_method', 'txt')
      .gte('upload_date', `${selectedDate}T00:00:00`)
      .lt('upload_date', `${selectedDate}T23:59:59`)
      .order('upload_date', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setPosFileUrl(data?.file_urls?.[0] || null);
      });
  }, [currentStoreId, selectedDate]);

  // Status filter tabs — pending split into "pending_count" (POS-only,
  // staff still has to physically count) and "pending_explain" (both
  // sides counted, diff over tolerance, owner needs an explanation).
  const statusTabs = useMemo(() => {
    const dateComparisons = selectedDate
      ? comparisons.filter((c) => c.comp_date === selectedDate)
      : comparisons;

    return [
      { id: 'all', label: t('comparison.all'), count: dateComparisons.length },
      {
        id: 'pending_count',
        label: t('comparison.statusPendingCount'),
        count: dateComparisons.filter(isPendingCount).length,
      },
      {
        id: 'pending_explain',
        label: t('comparison.statusPendingExplain'),
        count: dateComparisons.filter(isPendingExplain).length,
      },
      {
        id: 'explained',
        label: t('comparison.statusExplained'),
        count: dateComparisons.filter((c) => c.status === 'explained').length,
      },
      {
        id: 'approved',
        label: t('comparison.statusApproved'),
        count: dateComparisons.filter((c) => c.status === 'approved').length,
      },
      {
        id: 'rejected',
        label: t('comparison.statusRejected'),
        count: dateComparisons.filter((c) => c.status === 'rejected').length,
      },
    ];
  }, [comparisons, selectedDate, t]);

  // Standalone count for the banner — only the selected date.
  const needsCountForSelectedDate = useMemo(() => {
    if (!selectedDate) return 0;
    return comparisons.filter(
      (c) => c.comp_date === selectedDate && isPendingCount(c),
    ).length;
  }, [comparisons, selectedDate]);

  // Filtered data
  const filteredComparisons = useMemo(() => {
    let filtered = comparisons;

    // Filter by date
    if (selectedDate) {
      filtered = filtered.filter((c) => c.comp_date === selectedDate);
    }

    // Filter by status (pending split into two UX states)
    if (filterStatus === 'pending_count') {
      filtered = filtered.filter(isPendingCount);
    } else if (filterStatus === 'pending_explain') {
      filtered = filtered.filter(isPendingExplain);
    } else if (filterStatus !== 'all') {
      filtered = filtered.filter((c) => c.status === filterStatus);
    }

    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          (c.product_name || '').toLowerCase().includes(query) ||
          c.product_code.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [comparisons, selectedDate, filterStatus, searchQuery]);

  // Summary stats for the selected date
  const stats = useMemo(() => {
    const dateItems = selectedDate
      ? comparisons.filter((c) => c.comp_date === selectedDate)
      : comparisons;

    const total = dateItems.length;
    const match = dateItems.filter((c) => isEffectivelyZero(c.difference)).length;
    const withinTolerance = dateItems.filter(
      (c) =>
        !isEffectivelyZero(c.difference) &&
        isWithinTolerance(c),
    ).length;
    const overTolerance = dateItems.filter(
      (c) =>
        !isEffectivelyZero(c.difference) &&
        !isWithinTolerance(c),
    ).length;

    return { total, match, withinTolerance, overTolerance };
  }, [comparisons, selectedDate]);

  // Monthly statistics
  const monthlyStats = useMemo(() => {
    const prefix = selectedMonth;
    const dateGroups = new Map<string, Comparison[]>();
    for (const c of comparisons) {
      if (c.comp_date.startsWith(prefix)) {
        const group = dateGroups.get(c.comp_date) || [];
        group.push(c);
        dateGroups.set(c.comp_date, group);
      }
    }

    const result: DayStat[] = [];
    for (const [date, items] of dateGroups) {
      result.push({
        date,
        total: items.length,
        match: items.filter((i) => isEffectivelyZero(i.difference)).length,
        withinTolerance: items.filter(
          (i) =>
            !isEffectivelyZero(i.difference) &&
            isWithinTolerance(i),
        ).length,
        overTolerance: items.filter(
          (i) =>
            !isEffectivelyZero(i.difference) &&
            !isWithinTolerance(i),
        ).length,
        pending: items.filter((i) => i.status === 'pending').length,
        explained: items.filter((i) => i.status === 'explained').length,
        approved: items.filter((i) => i.status === 'approved').length,
      });
    }

    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }, [comparisons, selectedMonth]);

  // ── Trend chart data (week / month) ──
  const trendChartData = useMemo(() => {
    const now = nowBangkok();
    const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const endDate = now.toISOString().slice(0, 10);

    const dateGroups = new Map<string, Comparison[]>();
    for (const c of comparisons) {
      if (c.comp_date >= startDate && c.comp_date <= endDate) {
        const group = dateGroups.get(c.comp_date) || [];
        group.push(c);
        dateGroups.set(c.comp_date, group);
      }
    }

    const result: Array<{
      date: string;
      label: string;
      total: number;
      match: number;
      withinTolerance: number;
      overTolerance: number;
    }> = [];

    for (const [date, items] of dateGroups) {
      result.push({
        date,
        label: date.slice(8, 10),
        total: items.length,
        match: items.filter((i) => isEffectivelyZero(i.difference)).length,
        withinTolerance: items.filter(
          (i) => !isEffectivelyZero(i.difference) && isWithinTolerance(i),
        ).length,
        overTolerance: items.filter(
          (i) => !isEffectivelyZero(i.difference) && !isWithinTolerance(i),
        ).length,
      });
    }

    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }, [comparisons]);

  // (Per-product cross-day view + selected-product history live in
  // /stock/tracking now — that page is built for cross-day investigation
  // and consolidates the "babysit a few problem SKUs" workflow.)

  const monthLabel = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1, 15);
    return new Intl.DateTimeFormat('th-TH', {
      year: 'numeric',
      month: 'long',
    }).format(d);
  }, [selectedMonth]);

  const navigateMonth = (delta: number) => {
    setSelectedMonth((prev) => {
      const [y, m] = prev.split('-').map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  };

  const detailItems = useMemo(() => {
    if (!detailDate) return [];
    const items = comparisons.filter((c) => c.comp_date === detailDate);
    const order: Record<string, number> = {
      pending: 0,
      explained: 1,
      rejected: 2,
      approved: 3,
    };
    return items.sort(
      (a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9),
    );
  }, [comparisons, detailDate]);

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
              {t('comparison.title')}
            </h1>
          </div>
          <p className="mt-0.5 ml-9 text-sm text-gray-500 dark:text-gray-400">
            {t('comparison.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {posFileUrl && (
            <a href={posFileUrl} target="_blank" rel="noopener noreferrer">
              <Button
                variant="outline"
                size="sm"
                icon={<FileText className="h-4 w-4" />}
              >
                {t('comparison.posFile')}
              </Button>
            </a>
          )}
          <Button
            variant="outline"
            size="sm"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={fetchComparisons}
          >
            {t('comparison.refresh')}
          </Button>
        </div>
      </div>

      {/* Date selector */}
      {availableDates.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Calendar className="h-4 w-4 shrink-0 text-gray-400" />
          {availableDates.slice(0, 7).map((date) => (
            <button
              key={date}
              onClick={() => setSelectedDate(date)}
              className={cn(
                'shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                selectedDate === date
                  ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              )}
            >
              {formatThaiDate(date)}
            </button>
          ))}
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-xl bg-blue-50 px-3 py-3 text-center dark:bg-blue-900/20">
          <p className="text-lg font-bold text-blue-700 dark:text-blue-400">
            {stats.total}
          </p>
          <p className="text-[10px] text-blue-600 dark:text-blue-500">{t('comparison.all')}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 px-3 py-3 text-center dark:bg-emerald-900/20">
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
            {stats.match}
          </p>
          <p className="text-[10px] text-emerald-600 dark:text-emerald-500">{t('comparison.match')}</p>
        </div>
        <div className="rounded-xl bg-yellow-50 px-3 py-3 text-center dark:bg-yellow-900/20">
          <p className="text-lg font-bold text-yellow-700 dark:text-yellow-400">
            {stats.withinTolerance}
          </p>
          <p className="text-[10px] text-yellow-600 dark:text-yellow-500">
            {t('comparison.withinTolerance')}
          </p>
        </div>
        <div className="rounded-xl bg-red-50 px-3 py-3 text-center dark:bg-red-900/20">
          <p className="text-lg font-bold text-red-700 dark:text-red-400">
            {stats.overTolerance}
          </p>
          <p className="text-[10px] text-red-600 dark:text-red-500">{t('comparison.overTolerance')}</p>
        </div>
      </div>

      {/* Monthly Statistics */}
      <Card padding="none">
        <CardHeader
          title={t('comparison.dailyStats')}
          action={
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigateMonth(-1)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[120px] text-center text-xs font-medium text-gray-600 dark:text-gray-300">
                {monthLabel}
              </span>
              <button
                onClick={() => navigateMonth(1)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          }
        />

        {monthlyStats.length === 0 ? (
          <div className="px-4 pb-4 text-center text-xs text-gray-400">
            {t('comparison.noDataThisMonth')}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700">
                    <th className="px-3 py-2 text-left font-medium text-gray-500">
                      {t('comparison.dateCol')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">
                      {t('comparison.itemsCol')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-emerald-600">
                      {t('comparison.match')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-yellow-600">
                      {t('comparison.withinTolerance')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-red-600">
                      {t('comparison.overTolerance')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-orange-600">
                      {t('comparison.statusPending')}
                    </th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500">
                      {t('comparison.statusCol')}
                    </th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {monthlyStats.map((stat) => {
                    const allResolved = stat.pending === 0;
                    return (
                      <tr
                        key={stat.date}
                        onClick={() => {
                          setDetailDate(stat.date);
                          setSelectedDate(stat.date);
                        }}
                        className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
                      >
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">
                          {formatThaiDate(stat.date)}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">
                          {stat.total}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-emerald-600">
                          {stat.match}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-yellow-600">
                          {stat.withinTolerance}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-red-600">
                          {stat.overTolerance}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-orange-600">
                          {stat.pending}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {allResolved ? (
                            <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-500" />
                          ) : (
                            <AlertTriangle className="mx-auto h-4 w-4 text-amber-500" />
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Eye className="mx-auto h-4 w-4 text-gray-400" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="space-y-2 px-4 pb-4 md:hidden">
              {monthlyStats.map((stat) => {
                const allResolved = stat.pending === 0;
                return (
                  <button
                    key={stat.date}
                    onClick={() => {
                      setDetailDate(stat.date);
                      setSelectedDate(stat.date);
                    }}
                    className="w-full rounded-lg border border-gray-100 p-3 text-left transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/30"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-900 dark:text-white">
                        {formatThaiDate(stat.date)}
                      </span>
                      {allResolved ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Badge variant="warning">
                          {stat.pending} {t('comparison.statusPending')}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                      <div>
                        <p className="text-xs font-bold text-gray-700 dark:text-gray-200">
                          {stat.total}
                        </p>
                        <p className="text-[9px] text-gray-400">{t('comparison.itemsCol')}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-emerald-600">
                          {stat.match}
                        </p>
                        <p className="text-[9px] text-gray-400">{t('comparison.match')}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-yellow-600">
                          {stat.withinTolerance}
                        </p>
                        <p className="text-[9px] text-gray-400">{t('comparison.withinTolerance')}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-red-600">
                          {stat.overTolerance}
                        </p>
                        <p className="text-[9px] text-gray-400">{t('comparison.overTolerance')}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {/* ── Trend Chart ── (always current month) */}
      <Card padding="none">
        <CardHeader title={t('comparison.trendTitle')} />
        {trendChartData.length === 0 ? (
          <div className="px-4 pb-4 text-center text-xs text-gray-400">
            {t('comparison.noDataThisPeriod')}
          </div>
        ) : (
          <div className="px-2 pb-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trendChartData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={30} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(value: any, name: any) => {
                    const labels: Record<string, string> = {
                      match: t('comparison.match'),
                      withinTolerance: t('comparison.withinTolerance'),
                      overTolerance: t('comparison.overTolerance'),
                    };
                    return [value, labels[name] || name];
                  }}
                  labelFormatter={(label: any, payload: any) => {
                    const item = payload?.[0]?.payload;
                    return item?.date ? formatThaiDate(item.date) : label;
                  }}
                />
                <Legend
                  formatter={(value: any) => {
                    const labels: Record<string, string> = {
                      match: t('comparison.match'),
                      withinTolerance: t('comparison.withinTolerance'),
                      overTolerance: t('comparison.overTolerance'),
                    };
                    return <span className="text-[10px]">{labels[value] || value}</span>;
                  }}
                />
                <Bar dataKey="match" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                <Bar dataKey="withinTolerance" stackId="a" fill="#f59e0b" />
                <Bar dataKey="overTolerance" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Per-product cross-day grid lives in /stock/tracking — link there
          for users who used to drill into a single SKU's history. */}
      <a
        href="/stock/tracking"
        className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50"
      >
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('comparison.productView')}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('comparison.productViewMovedHint')}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-gray-400" />
      </a>

      {/* Search */}
      <Input
        placeholder={t('comparison.searchProduct')}
        leftIcon={<Search className="h-4 w-4" />}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      {/* Needs-count banner — only when the selected date has POS-only
          rows. Staff should finish counting before owner reviews
          variances, so we surface this above the explain tabs. */}
      {needsCountForSelectedDate > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-700/50 dark:bg-amber-900/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                {t('comparison.needsCountBannerTitle', { count: needsCountForSelectedDate })}
              </p>
              <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
                {t('comparison.needsCountBannerHint')}
              </p>
            </div>
          </div>
          <a
            href={`/stock/daily-check?date=${selectedDate}&supplementary=1`}
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 sm:shrink-0 dark:bg-amber-500 dark:hover:bg-amber-600"
          >
            {t('comparison.needsCountBannerCta')}
            <ChevronRight className="h-3.5 w-3.5" />
          </a>
        </div>
      )}

      {/* Status Filter Tabs */}
      <Tabs
        tabs={statusTabs}
        activeTab={filterStatus}
        onChange={(id) => setFilterStatus(id as FilterStatus)}
      />

      {/* Comparison Table (mobile-friendly card list) */}
      {filteredComparisons.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title={t('comparison.noData')}
          description={
            selectedDate
              ? t('comparison.noDataForDate')
              : t('comparison.noComparisonData')
          }
        />
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700 md:block">
            {/* Inner wrapper owns the scroll (both axes) so the sticky
                thead can pin against it as the user scans long lists. */}
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full text-sm">
                {/* Sticky head — long lists previously scrolled the head
                    out of view, leaving the user without column labels.
                    `sticky top-0` pins it to the viewport while the
                    page scrolls; the explicit bg keeps rows from
                    bleeding through the translucent layer. */}
                <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800/95">
                  <tr className="border-b border-gray-100 dark:border-gray-700">
                    <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                      {t('comparison.product')}
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                      POS
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                      {t('comparison.manualCount')}
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                      {t('comparison.difference')}
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                      %
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-gray-500 dark:text-gray-400">
                      {t('comparison.level')}
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-gray-500 dark:text-gray-400">
                      {t('comparison.statusCol')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filteredComparisons.map((item) => {
                    // POS-only rows render with neutral styling — the
                    // -100% diff is mathematically real but operationally
                    // meaningless (staff just hasn't counted yet).
                    const needsCount = isPendingCount(item);
                    const diffColor = getDiffColor(item);
                    const statusConfig = needsCount
                      ? {
                          label: t('comparison.statusPendingCount'),
                          variant: 'info' as const,
                          icon: Clock,
                        }
                      : getStatusConfig(item.status, t);
                    return (
                      <tr
                        key={item.id}
                        className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900 dark:text-white">
                            {item.product_name || item.product_code}
                          </p>
                          <p className="text-xs text-gray-400">
                            {item.product_code}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                          {formatQty(item.pos_quantity)}
                        </td>
                        <td className={cn(
                          'px-4 py-3 text-right font-medium',
                          needsCount
                            ? 'text-blue-600 italic dark:text-blue-400'
                            : 'text-gray-900 dark:text-white',
                        )}>
                          {editingId === item.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="number"
                                step="0.01"
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') requestSave(item);
                                  if (e.key === 'Escape') cancelEdit();
                                }}
                                autoFocus
                                disabled={savingId === item.id}
                                className="w-24 rounded border border-gray-300 bg-white px-2 py-1 text-right text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                              />
                              <button
                                type="button"
                                onClick={() => requestSave(item)}
                                disabled={savingId === item.id}
                                className="rounded p-1 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
                                aria-label="บันทึก"
                              >
                                {savingId === item.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="h-4 w-4" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                disabled={savingId === item.id}
                                className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700"
                                aria-label="ยกเลิก"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="group inline-flex items-center justify-end gap-1.5">
                              <span>
                                {needsCount
                                  ? t('comparison.statusPendingCount')
                                  : formatQty(item.manual_quantity)}
                              </span>
                              {canEditManual && (
                                <button
                                  type="button"
                                  onClick={() => beginEdit(item)}
                                  className="rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:bg-gray-100 hover:text-indigo-600 group-hover:opacity-100 dark:hover:bg-gray-700"
                                  aria-label="แก้ไขจำนวนนับจริง"
                                  title="แก้ไขจำนวนนับจริง"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className={cn(
                          'px-4 py-3 text-right font-bold',
                          needsCount ? 'text-gray-300 dark:text-gray-600' : diffColor.text,
                        )}>
                          {needsCount ? '—' : formatSignedQty(item.difference)}
                        </td>
                        <td className={cn(
                          'px-4 py-3 text-right text-xs font-medium',
                          needsCount ? 'text-gray-300 dark:text-gray-600' : diffColor.text,
                        )}>
                          {needsCount
                            ? '—'
                            : item.diff_percent !== null
                              ? formatPercent(item.diff_percent)
                              : '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {needsCount ? (
                            <span className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
                              {t('comparison.statusPendingCount')}
                            </span>
                          ) : (
                            <span
                              className={cn(
                                'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                diffColor.bg,
                                diffColor.text,
                              )}
                            >
                              {t(diffColor.labelKey)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant={statusConfig.variant}>
                            {statusConfig.label}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card List */}
          <div className="space-y-2 md:hidden">
            {filteredComparisons.map((item) => {
              const needsCount = isPendingCount(item);
              const diffColor = getDiffColor(item);
              const statusConfig = needsCount
                ? {
                    label: t('comparison.statusPendingCount'),
                    variant: 'info' as const,
                    icon: Clock,
                  }
                : getStatusConfig(item.status, t);
              const DiffIcon = isEffectivelyZero(item.difference)
                ? Minus
                : (item.difference as number) > 0
                  ? TrendingUp
                  : TrendingDown;

              return (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-xl bg-white p-4 shadow-sm ring-1 dark:bg-gray-800',
                    needsCount
                      ? 'ring-blue-200 dark:ring-blue-800'
                      : diffColor.ring,
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {item.product_name || item.product_code}
                      </p>
                      <p className="text-xs text-gray-400">{item.product_code}</p>
                    </div>
                    <Badge variant={statusConfig.variant}>
                      {statusConfig.label}
                    </Badge>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500">
                        POS
                      </p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatQty(item.pos_quantity)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500">
                        {t('comparison.manualCount')}
                      </p>
                      <p className={cn(
                        'text-sm font-medium',
                        needsCount
                          ? 'italic text-blue-600 dark:text-blue-400'
                          : 'text-gray-900 dark:text-white',
                      )}>
                        {needsCount ? t('comparison.statusPendingCount') : formatQty(item.manual_quantity)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500">
                        {t('comparison.difference')}
                      </p>
                      {needsCount ? (
                        <p className="text-sm font-bold text-gray-300 dark:text-gray-600">—</p>
                      ) : (
                        <div className="flex items-center gap-1">
                          <DiffIcon className={cn('h-3.5 w-3.5', diffColor.text)} />
                          <p className={cn('text-sm font-bold', diffColor.text)}>
                            {formatSignedQty(item.difference)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    {needsCount ? (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
                        {t('comparison.statusPendingCount')}
                      </span>
                    ) : (
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        diffColor.bg,
                        diffColor.text,
                      )}>
                        {t(diffColor.labelKey)}
                        {!isEffectivelyZero(item.difference) &&
                          item.diff_percent !== null &&
                          ` (${formatPercent(item.diff_percent)})`}
                      </span>
                    )}
                    {item.explanation && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">
                        {t('comparison.hasExplanation')}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Manual-count edit confirmation modal */}
      <Modal
        isOpen={!!confirming}
        onClose={() => savingId === null && setConfirming(null)}
        title="ยืนยันการแก้ไขจำนวนนับจริง"
        size="md"
      >
        {confirming && (
          <div className="space-y-3">
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-700/50">
              <p className="font-semibold text-gray-900 dark:text-white">
                {confirming.item.product_name || confirming.item.product_code}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                {confirming.item.product_code} ·{' '}
                {formatThaiDate(confirming.item.comp_date)}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg bg-gray-50 p-2 text-center dark:bg-gray-700/50">
                <p className="text-[10px] text-gray-400">POS</p>
                <p className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                  {formatQty(confirming.item.pos_quantity)}
                </p>
              </div>
              <div className="rounded-lg bg-amber-50 p-2 text-center dark:bg-amber-900/20">
                <p className="text-[10px] text-amber-700 dark:text-amber-400">นับจริง (เดิม)</p>
                <p className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {formatQty(confirming.item.manual_quantity)}
                </p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-2 text-center dark:bg-emerald-900/20">
                <p className="text-[10px] text-emerald-700 dark:text-emerald-400">นับจริง (ใหม่)</p>
                <p className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatQty(confirming.newQty)}
                </p>
              </div>
            </div>
            {(() => {
              const d = deriveComparisonFields(
                confirming.newQty,
                confirming.item.pos_quantity,
                tolerance,
              );
              return (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm dark:border-indigo-700 dark:bg-indigo-900/20">
                  <p className="text-xs text-indigo-600 dark:text-indigo-300">
                    ส่วนต่างใหม่
                  </p>
                  <p className="font-bold text-indigo-900 dark:text-indigo-100">
                    {formatSignedQty(d.difference)}
                    {d.diff_percent !== null && (
                      <span className="ml-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                        ({formatPercent(d.diff_percent)})
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-[11px] text-indigo-700 dark:text-indigo-300">
                    สถานะใหม่: <b>{d.status === 'approved' ? 'ผ่าน' : 'รอชี้แจง'}</b>
                    {' · '}คำชี้แจง/อนุมัติเดิมจะถูกล้าง
                  </p>
                </div>
              );
            })()}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirming(null)}
                disabled={savingId !== null}
              >
                ยกเลิก
              </Button>
              <Button
                size="sm"
                onClick={commitSave}
                disabled={savingId !== null}
                icon={
                  savingId !== null ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )
                }
              >
                ยืนยันบันทึก
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Detail Modal */}
      <Modal
        isOpen={!!detailDate}
        onClose={() => setDetailDate(null)}
        title={detailDate ? t('comparison.detailTitle', { date: formatThaiDate(detailDate) }) : ''}
        size="full"
      >
        <div className="max-h-[60vh] overflow-y-auto">
          {/* Modal summary */}
          {detailDate &&
            (() => {
              const stat = monthlyStats.find((s) => s.date === detailDate);
              if (!stat) return null;
              return (
                <div className="mb-4 grid grid-cols-4 gap-2">
                  <div className="rounded-lg bg-blue-50 p-2 text-center dark:bg-blue-900/20">
                    <p className="text-sm font-bold text-blue-700 dark:text-blue-400">
                      {stat.total}
                    </p>
                    <p className="text-[9px] text-blue-600">{t('comparison.all')}</p>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-2 text-center dark:bg-emerald-900/20">
                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                      {stat.match}
                    </p>
                    <p className="text-[9px] text-emerald-600">{t('comparison.match')}</p>
                  </div>
                  <div className="rounded-lg bg-yellow-50 p-2 text-center dark:bg-yellow-900/20">
                    <p className="text-sm font-bold text-yellow-700 dark:text-yellow-400">
                      {stat.withinTolerance}
                    </p>
                    <p className="text-[9px] text-yellow-600">{t('comparison.withinTolerance')}</p>
                  </div>
                  <div className="rounded-lg bg-red-50 p-2 text-center dark:bg-red-900/20">
                    <p className="text-sm font-bold text-red-700 dark:text-red-400">
                      {stat.overTolerance}
                    </p>
                    <p className="text-[9px] text-red-600">{t('comparison.overTolerance')}</p>
                  </div>
                </div>
              );
            })()}

          {/* Items list */}
          <div className="space-y-2">
            {detailItems.map((item) => {
              const needsCount = isPendingCount(item);
              const diffColor = getDiffColor(item);
              const statusConfig = needsCount
                ? {
                    label: t('comparison.statusPendingCount'),
                    variant: 'info' as const,
                    icon: Clock,
                  }
                : getStatusConfig(item.status, t);
              const matchHere = isEffectivelyZero(item.difference);
              return (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-lg border p-3',
                    needsCount ? 'ring-blue-200 dark:ring-blue-800' : diffColor.ring,
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {item.product_name || item.product_code}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {item.product_code}
                      </p>
                    </div>
                    <Badge variant={statusConfig.variant}>
                      {statusConfig.label}
                    </Badge>
                  </div>

                  <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <span className="text-gray-400">POS: </span>
                      <span className="font-medium text-gray-700 dark:text-gray-200">
                        {formatQty(item.pos_quantity)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">{t('comparison.countShort')}: </span>
                      <span className={cn(
                        'font-medium',
                        needsCount
                          ? 'italic text-blue-600 dark:text-blue-400'
                          : 'text-gray-700 dark:text-gray-200',
                      )}>
                        {needsCount ? t('comparison.statusPendingCount') : formatQty(item.manual_quantity)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">{t('comparison.diffShort')}: </span>
                      <span className={cn(
                        'font-bold',
                        needsCount ? 'text-gray-300 dark:text-gray-600' : diffColor.text,
                      )}>
                        {needsCount ? '—' : formatSignedQty(item.difference)}
                      </span>
                    </div>
                    <div>
                      {needsCount ? (
                        <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
                          {t('comparison.statusPendingCount')}
                        </span>
                      ) : (
                        <span className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                          diffColor.bg,
                          diffColor.text,
                        )}>
                          {t(diffColor.labelKey)}
                          {!matchHere && item.diff_percent !== null
                            ? ` (${formatPercent(item.diff_percent)})`
                            : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Explanation */}
                  {item.explanation && (
                    <div className="mt-2 rounded-lg bg-blue-50 p-2 dark:bg-blue-900/20">
                      <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400">
                        {t('comparison.explanationLabel')}:
                      </p>
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        {item.explanation}
                      </p>
                    </div>
                  )}
                  {item.owner_notes && (
                    <div className="mt-1 rounded-lg bg-gray-50 p-2 dark:bg-gray-700/50">
                      <p className="text-[10px] font-medium text-gray-500">
                        {t('comparison.ownerNotes')}:
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-300">
                        {item.owner_notes}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    </div>
  );
}
