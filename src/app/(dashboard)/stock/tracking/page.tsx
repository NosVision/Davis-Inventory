'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { Button, Card, CardContent, EmptyState, Badge, Textarea, Modal, toast } from '@/components/ui';
import { formatSignedQty } from '@/lib/utils/format';
import { nowBangkok } from '@/lib/utils/date';
import { cn } from '@/lib/utils/cn';
import {
  Pin,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Search,
  Loader2,
  Package,
  HelpCircle,
  Star,
  History,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const TRACKING_ROLES = ['owner', 'accountant', 'manager', 'hq'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComparisonRow {
  id: string;
  comp_date: string;
  product_code: string;
  product_name: string | null;
  difference: number | null;
  diff_percent: number | null;
  status: string;
  pos_quantity: number | null;
  manual_quantity: number | null;
}

interface TrackingItem {
  id: string;
  store_id: string;
  product_code: string;
  product_name: string | null;
  is_tracking: boolean;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  reason: string | null;
  notes: string | null;
  follow_up_action: string | null;
  source: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ProductRow {
  product_code: string;
  product_name: string;
  days: Map<string, ComparisonRow>;
  totalOverTolerance: number;
  pendingCount: number;       // status === 'pending' AND has both sides
  rejectedCount: number;
  avgDiff: number;
  latestDelta: number | null; // last_diff − previous_diff, last 2 days with data
  latestDeltaDates: { from: string; to: string } | null;
  trendSlope: number;         // linear regression slope of daily diffs
  tracking: TrackingItem | null;
  pinned: boolean;
}

type FilterStatus = 'all' | 'tracking' | 'resolved' | 'untracked' | 'pinned';
type FilterTrend = 'all' | 'worsening' | 'improving';
type SortBy = 'pinned_first' | 'over_tolerance' | 'recent_pending' | 'slope';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isEffectivelyZero = (n: number | null | undefined) =>
  n === null || n === undefined || Math.abs(n) < 0.005;

// Default tolerances — kept in sync with /stock/comparison and the
// compare API's auto-approve rule. Hard-coded here because we don't
// pass per-store store_settings into the page; if any store ever
// diverges we'll thread the live values through.
const PERCENT_TOLERANCE = 5;
const UNIT_TOLERANCE = 0.4;

const isWithinTolerance = (difference: number | null, diffPercent: number | null) => {
  if (difference === null) return false;
  return (
    Math.abs(difference) <= UNIT_TOLERANCE ||
    Math.abs(diffPercent || 0) <= PERCENT_TOLERANCE
  );
};

function classifyTrend(slope: number): 'worsening' | 'improving' | 'stable' {
  if (slope > 0.05) return 'worsening';
  if (slope < -0.05) return 'improving';
  return 'stable';
}

// Linear regression slope of {x=index, y=diff}. Returns 0 when fewer
// than 2 valid points or all x identical.
function computeSlope(diffs: number[]): number {
  if (diffs.length < 2) return 0;
  const n = diffs.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += diffs[i];
    sumXY += i * diffs[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

const PRIORITY_CONFIG: Record<TrackingItem['priority'], { label: string; bg: string; text: string }> = {
  urgent: { label: 'ด่วนมาก', bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400' },
  high: { label: 'สูง', bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400' },
  normal: { label: 'ปกติ', bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400' },
  low: { label: 'ต่ำ', bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400' },
};

interface HistoryEvent {
  id: string;
  action: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  created_by_name?: string | null;
}

const ACTION_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  flagged: { label: 'เริ่มติดตาม', emoji: '📌', color: 'text-indigo-600 dark:text-indigo-400' },
  noted: { label: 'อัปเดตโน๊ต', emoji: '📝', color: 'text-blue-600 dark:text-blue-400' },
  escalated: { label: 'ยกระดับความสำคัญ', emoji: '⚠️', color: 'text-orange-600 dark:text-orange-400' },
  resolved: { label: 'ปิดเคส', emoji: '✅', color: 'text-emerald-600 dark:text-emerald-400' },
  reopened: { label: 'เปิดเคสใหม่', emoji: '🔄', color: 'text-amber-600 dark:text-amber-400' },
  auto_flagged: { label: 'flag อัตโนมัติ', emoji: '🤖', color: 'text-purple-600 dark:text-purple-400' },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function StockTrackingPage() {
  const { user } = useAuthStore();
  const { currentStoreId } = useAppStore();
  const canEdit = !!user && TRACKING_ROLES.includes(user.role);

  // Page-level role guard
  if (user && !TRACKING_ROLES.includes(user.role)) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <AlertTriangle className="h-10 w-10 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          ไม่มีสิทธิ์เข้าหน้านี้ — เฉพาะเจ้าของร้าน / บัญชี / ผู้จัดการ
        </p>
        <a
          href="/stock"
          className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          กลับหน้าสต๊อก
        </a>
      </div>
    );
  }

  const [comparisons, setComparisons] = useState<ComparisonRow[]>([]);
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [bookmarkedCodes, setBookmarkedCodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Calendar month navigation — defaults to current month, matches the
  // /stock/comparison page so users can switch between the two pages
  // and stay oriented.
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = nowBangkok();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterTrend, setFilterTrend] = useState<FilterTrend>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('pinned_first');

  const [editingItem, setEditingItem] = useState<{
    product_code: string;
    product_name: string;
    existing: TrackingItem | null;
  } | null>(null);

  const [showHelp, setShowHelp] = useState(false);
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[] | 'loading' | null>(null);

  const [editForm, setEditForm] = useState({
    is_tracking: true,
    priority: 'normal' as TrackingItem['priority'],
    reason: '',
    notes: '',
    follow_up_action: '',
    resolution_notes: '',
  });

  // ── Load data ──
  const loadData = useCallback(async () => {
    if (!currentStoreId) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const [y, m] = selectedMonth.split('-').map(Number);
      const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
      // Compute "first of next month" by hand — `Date.toISOString()` is
      // UTC, which would slip a day when the user's clock straddles
      // midnight in Bangkok, dropping the last day of the month from
      // the query window.
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      const endDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

      const [compsRes, itemsRes, bookmarksRes] = await Promise.all([
        supabase
          .from('comparisons')
          .select('id, comp_date, product_code, product_name, difference, diff_percent, status, pos_quantity, manual_quantity')
          .eq('store_id', currentStoreId)
          .gte('comp_date', startDate)
          .lt('comp_date', endDate)
          .order('comp_date', { ascending: true }),
        supabase
          .from('stock_tracking_items')
          .select('*')
          .eq('store_id', currentStoreId),
        user?.id
          ? supabase
              .from('comparison_product_bookmarks')
              .select('product_code')
              .eq('user_id', user.id)
              .eq('store_id', currentStoreId)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (compsRes.data) setComparisons(compsRes.data as ComparisonRow[]);
      if (itemsRes.data) setItems(itemsRes.data as TrackingItem[]);
      if (bookmarksRes.data) {
        setBookmarkedCodes(new Set((bookmarksRes.data as { product_code: string }[]).map((r) => r.product_code)));
      }
    } catch (err) {
      console.error('Tracking load error:', err);
    } finally {
      setLoading(false);
    }
  }, [currentStoreId, selectedMonth, user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Build per-product map ──
  const { products, allDates } = useMemo(() => {
    const map = new Map<string, ProductRow>();
    const dates = new Set<string>();
    const itemMap = new Map(items.map((i) => [i.product_code, i]));

    for (const c of comparisons) {
      dates.add(c.comp_date);
      if (!map.has(c.product_code)) {
        map.set(c.product_code, {
          product_code: c.product_code,
          product_name: c.product_name || c.product_code,
          days: new Map(),
          totalOverTolerance: 0,
          pendingCount: 0,
          rejectedCount: 0,
          avgDiff: 0,
          latestDelta: null,
          latestDeltaDates: null,
          trendSlope: 0,
          tracking: itemMap.get(c.product_code) || null,
          pinned: bookmarkedCodes.has(c.product_code),
        });
      }
      const p = map.get(c.product_code)!;
      p.days.set(c.comp_date, c);
      // POS-only rows (manual=null) aren't real discrepancies; they're
      // just "not counted yet", so they don't bump any of the
      // tracking-relevant counters.
      if (c.manual_quantity !== null) {
        if (!isEffectivelyZero(c.difference) && !isWithinTolerance(c.difference, c.diff_percent)) {
          p.totalOverTolerance++;
        }
        if (c.status === 'pending') p.pendingCount++;
        if (c.status === 'rejected') p.rejectedCount++;
      }
    }

    // avg diff + latest delta + slope
    for (const p of map.values()) {
      const datedDiffs = [...p.days.entries()]
        .filter(([, d]) => d.difference !== null && d.manual_quantity !== null)
        .map(([date, d]) => ({ date, diff: d.difference as number }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const diffs = datedDiffs.map((d) => d.diff);
      p.avgDiff = diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
      p.trendSlope = computeSlope(diffs);

      if (datedDiffs.length >= 2) {
        const last = datedDiffs[datedDiffs.length - 1];
        const prev = datedDiffs[datedDiffs.length - 2];
        p.latestDelta = Math.round((last.diff - prev.diff) * 100) / 100;
        p.latestDeltaDates = { from: prev.date, to: last.date };
      }
    }

    return {
      products: [...map.values()],
      allDates: [...dates].sort(),
    };
  }, [comparisons, items, bookmarkedCodes]);

  // ── Filter + sort ──
  const displayed = useMemo(() => {
    let result = products;

    if (filterStatus === 'tracking') {
      result = result.filter((p) => p.tracking?.is_tracking);
    } else if (filterStatus === 'resolved') {
      result = result.filter((p) => p.tracking && !p.tracking.is_tracking);
    } else if (filterStatus === 'untracked') {
      result = result.filter((p) => !p.tracking);
    } else if (filterStatus === 'pinned') {
      result = result.filter((p) => p.pinned);
    }

    if (filterTrend !== 'all') {
      result = result.filter((p) => classifyTrend(p.trendSlope) === filterTrend);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.product_code.toLowerCase().includes(q) ||
          p.product_name.toLowerCase().includes(q),
      );
    }

    const sorted = [...result];
    sorted.sort((a, b) => {
      // Pinned-first is the default — even when other sorts are active
      // we still float pinned rows up so the user can babysit them.
      if (sortBy === 'pinned_first') {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.totalOverTolerance - a.totalOverTolerance || Math.abs(b.avgDiff) - Math.abs(a.avgDiff);
      }
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sortBy === 'over_tolerance') return b.totalOverTolerance - a.totalOverTolerance;
      if (sortBy === 'recent_pending') return b.pendingCount - a.pendingCount;
      if (sortBy === 'slope') return b.trendSlope - a.trendSlope;
      return 0;
    });
    return sorted.slice(0, 100);
  }, [products, filterStatus, filterTrend, searchQuery, sortBy]);

  // ── Stats summary ──
  const stats = useMemo(() => {
    const tracking = items.filter((i) => i.is_tracking).length;
    const urgent = items.filter((i) => i.is_tracking && i.priority === 'urgent').length;
    const totalProducts = products.length;
    const worsening = products.filter((p) => classifyTrend(p.trendSlope) === 'worsening').length;
    const totalPending = products.reduce((s, p) => s + p.pendingCount, 0);
    return { tracking, urgent, totalProducts, worsening, totalPending };
  }, [items, products]);

  // ── Pin toggle (optimistic) ──
  const togglePin = useCallback(async (productCode: string) => {
    if (!user?.id || !currentStoreId) return;
    const wasPinned = bookmarkedCodes.has(productCode);
    setBookmarkedCodes((prev) => {
      const next = new Set(prev);
      if (wasPinned) next.delete(productCode);
      else next.add(productCode);
      return next;
    });
    const supabase = createClient();
    const { error } = wasPinned
      ? await supabase
          .from('comparison_product_bookmarks')
          .delete()
          .eq('user_id', user.id)
          .eq('store_id', currentStoreId)
          .eq('product_code', productCode)
      : await supabase
          .from('comparison_product_bookmarks')
          .upsert({ user_id: user.id, store_id: currentStoreId, product_code: productCode }, { onConflict: 'user_id,store_id,product_code' });
    if (error) {
      // Roll back optimistic flip
      setBookmarkedCodes((prev) => {
        const next = new Set(prev);
        if (wasPinned) next.add(productCode);
        else next.delete(productCode);
        return next;
      });
      toast({ type: 'error', title: 'ปักหมุดไม่สำเร็จ' });
    }
  }, [user?.id, currentStoreId, bookmarkedCodes]);

  // ── Open edit modal (with history) ──
  const openEdit = (row: ProductRow) => {
    if (!canEdit) {
      toast({ type: 'warning', title: 'ไม่มีสิทธิ์แก้ไข' });
      return;
    }
    setEditingItem({
      product_code: row.product_code,
      product_name: row.product_name,
      existing: row.tracking,
    });
    if (row.tracking) {
      setEditForm({
        is_tracking: row.tracking.is_tracking,
        priority: row.tracking.priority,
        reason: row.tracking.reason || '',
        notes: row.tracking.notes || '',
        follow_up_action: row.tracking.follow_up_action || '',
        resolution_notes: row.tracking.resolution_notes || '',
      });
      // Lazy-load history when an existing tracked item is opened —
      // keeps the modal snappy when flagging a fresh SKU.
      setHistoryEvents('loading');
      const supabase = createClient();
      supabase
        .from('stock_tracking_history')
        .select('id, action, payload, created_at, profile:profiles!stock_tracking_history_created_by_fkey(display_name, username)')
        .eq('tracking_item_id', row.tracking.id)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          const events: HistoryEvent[] = (data || []).map((d) => {
            const pr = d.profile as { display_name?: string; username?: string } | null;
            return {
              id: d.id,
              action: d.action,
              payload: d.payload as Record<string, unknown> | null,
              created_at: d.created_at,
              created_by_name: pr?.display_name || pr?.username || null,
            };
          });
          setHistoryEvents(events);
        });
    } else {
      setEditForm({
        is_tracking: true,
        priority: 'normal',
        reason: '',
        notes: '',
        follow_up_action: '',
        resolution_notes: '',
      });
      setHistoryEvents(null);
    }
  };

  const closeEdit = () => {
    setEditingItem(null);
    setHistoryEvents(null);
  };

  // ── Save (upsert + history log) ──
  const handleSave = async () => {
    if (!editingItem || !user || !currentStoreId) return;
    const supabase = createClient();
    try {
      const isNew = !editingItem.existing;
      let itemId: string | null = editingItem.existing?.id || null;

      if (isNew) {
        const { data, error } = await supabase
          .from('stock_tracking_items')
          .insert({
            store_id: currentStoreId,
            product_code: editingItem.product_code,
            product_name: editingItem.product_name,
            is_tracking: editForm.is_tracking,
            priority: editForm.priority,
            reason: editForm.reason || null,
            notes: editForm.notes || null,
            follow_up_action: editForm.follow_up_action || null,
            source: 'manual',
            created_by: user.id,
          })
          .select('id')
          .single();
        if (error) throw error;
        itemId = data.id;
      } else {
        const wasTracking = editingItem.existing!.is_tracking;
        const isResolving = wasTracking && !editForm.is_tracking;
        const isReopening = !wasTracking && editForm.is_tracking;
        const { error } = await supabase
          .from('stock_tracking_items')
          .update({
            is_tracking: editForm.is_tracking,
            priority: editForm.priority,
            reason: editForm.reason || null,
            notes: editForm.notes || null,
            follow_up_action: editForm.follow_up_action || null,
            resolution_notes: isResolving ? editForm.resolution_notes || null : editingItem.existing!.resolution_notes,
            resolved_at: isResolving ? new Date().toISOString() : isReopening ? null : editingItem.existing!.resolved_at,
            resolved_by: isResolving ? user.id : isReopening ? null : editingItem.existing!.resolved_by,
          })
          .eq('id', editingItem.existing!.id);
        if (error) throw error;
      }

      if (itemId) {
        const action = isNew
          ? 'flagged'
          : !editForm.is_tracking
            ? 'resolved'
            : !editingItem.existing!.is_tracking
              ? 'reopened'
              : 'noted';
        await supabase.from('stock_tracking_history').insert({
          tracking_item_id: itemId,
          action,
          payload: {
            priority: editForm.priority,
            reason: editForm.reason,
            notes: editForm.notes,
            follow_up_action: editForm.follow_up_action,
            resolution_notes: editForm.resolution_notes,
          },
          created_by: user.id,
        });
      }

      toast({ type: 'success', title: 'บันทึกสำเร็จ' });
      closeEdit();
      await loadData();
    } catch (err) {
      toast({
        type: 'error',
        title: 'บันทึกไม่สำเร็จ',
        message: err instanceof Error ? err.message : '',
      });
    }
  };

  // ── Auto-flag ──
  const handleAutoFlag = async () => {
    if (!currentStoreId || !user) return;
    const supabase = createClient();
    const candidates = products.filter((p) => {
      if (p.tracking) return false;
      return p.rejectedCount >= 1 || p.pendingCount >= 3;
    });
    if (candidates.length === 0) {
      toast({ type: 'info', title: 'ไม่มีรายการเข้าเกณฑ์ใหม่' });
      return;
    }
    try {
      const rows = candidates.map((c) => ({
        store_id: currentStoreId,
        product_code: c.product_code,
        product_name: c.product_name,
        is_tracking: true,
        priority: c.rejectedCount > 0 ? 'high' : 'normal',
        reason:
          c.rejectedCount > 0
            ? `เจ้าของไม่อนุมัติคำชี้แจง ${c.rejectedCount} ครั้งในเดือนนี้`
            : `ส่วนต่างค้างชี้แจง ${c.pendingCount} ครั้งในเดือนนี้`,
        source: c.rejectedCount > 0 ? 'auto_rejected' : 'auto_recurring',
        created_by: user.id,
      }));
      const { data, error } = await supabase
        .from('stock_tracking_items')
        .insert(rows)
        .select('id, product_code');
      if (error) throw error;

      if (data) {
        await supabase.from('stock_tracking_history').insert(
          data.map((d) => ({
            tracking_item_id: d.id,
            action: 'auto_flagged',
            payload: { product_code: d.product_code },
            created_by: user.id,
          })),
        );
      }
      toast({
        type: 'success',
        title: `Auto-flag ${candidates.length} รายการ`,
      });
      await loadData();
    } catch (err) {
      toast({
        type: 'error',
        title: 'Auto-flag ไม่สำเร็จ',
        message: err instanceof Error ? err.message : '',
      });
    }
  };

  // ── Month nav ──
  const navigateMonth = (delta: number) => {
    setSelectedMonth((prev) => {
      const [y, m] = prev.split('-').map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  };

  const monthLabel = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1, 15);
    return new Intl.DateTimeFormat('th-TH', {
      year: 'numeric',
      month: 'long',
    }).format(d);
  }, [selectedMonth]);

  if (!currentStoreId) {
    return (
      <EmptyState
        icon={Package}
        title="กรุณาเลือกสาขา"
        description="เลือกสาขาก่อนดูข้อมูลติดตาม"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-white">
            ติดตามผลต่างสต๊อก
          </h1>
          <p className="mt-0.5 text-xs text-gray-500 sm:text-sm dark:text-gray-400">
            ตารางมุมมองรายสินค้าข้ามวัน + ปักหมุดสินค้าที่จับตา (เดือน {monthLabel})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1 dark:border-gray-700 dark:bg-gray-800">
            <button
              onClick={() => navigateMonth(-1)}
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[100px] text-center text-xs font-medium text-gray-600 dark:text-gray-300">
              {monthLabel}
            </span>
            <button
              onClick={() => navigateMonth(1)}
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            icon={<HelpCircle className="h-3.5 w-3.5" />}
            onClick={() => setShowHelp(true)}
          >
            วิธีใช้
          </Button>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              icon={<Pin className="h-3.5 w-3.5" />}
              onClick={handleAutoFlag}
            >
              Auto-flag
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="กำลังติดตาม" value={stats.tracking} color="indigo" icon={Pin} />
        <StatCard label="ด่วนมาก" value={stats.urgent} color="red" icon={AlertTriangle} />
        <StatCard label="แนวโน้มแย่ลง" value={stats.worsening} color="orange" icon={TrendingUp} />
        <StatCard label="ค้างชี้แจง" value={stats.totalPending} color="amber" icon={AlertTriangle} />
        <StatCard label="สินค้ามีผลต่าง" value={stats.totalProducts} color="blue" icon={Package} />
      </div>

      {/* Filter row */}
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาชื่อสินค้า/รหัส..."
                className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-2 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </div>

            <FilterPill label="ทั้งหมด" active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} />
            <FilterPill label="ปักหมุด" active={filterStatus === 'pinned'} onClick={() => setFilterStatus(filterStatus === 'pinned' ? 'all' : 'pinned')} color="amber" />
            <FilterPill label="กำลังติดตาม" active={filterStatus === 'tracking'} onClick={() => setFilterStatus('tracking')} />
            <FilterPill label="ปิดเคสแล้ว" active={filterStatus === 'resolved'} onClick={() => setFilterStatus('resolved')} />
            <FilterPill label="ยังไม่ flag" active={filterStatus === 'untracked'} onClick={() => setFilterStatus('untracked')} />

            <div className="ml-2 h-4 w-px bg-gray-200 dark:bg-gray-700" />

            <FilterPill label="↗ แย่ลง" active={filterTrend === 'worsening'} onClick={() => setFilterTrend(filterTrend === 'worsening' ? 'all' : 'worsening')} color="red" />
            <FilterPill label="↘ ดีขึ้น" active={filterTrend === 'improving'} onClick={() => setFilterTrend(filterTrend === 'improving' ? 'all' : 'improving')} color="emerald" />

            <div className="ml-2 h-4 w-px bg-gray-200 dark:bg-gray-700" />

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              <option value="pinned_first">เรียง: ปักหมุดก่อน + ผลต่างมาก</option>
              <option value="over_tolerance">เรียง: เกินเกณฑ์มาก</option>
              <option value="recent_pending">เรียง: ค้างชี้แจงมาก</option>
              <option value="slope">เรียง: เทรนแย่ลง</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Cross-day grid */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      ) : displayed.length === 0 ? (
        <EmptyState icon={Package} title="ไม่มีรายการ" description="ลองเปลี่ยนตัวกรอง หรือเดือนนี้ไม่มีข้อมูลเปรียบเทียบ" />
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto px-4 pt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="sticky left-0 z-10 bg-white py-2 pr-2 text-left font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400" style={{ minWidth: 220 }}>
                    สินค้า
                  </th>
                  {allDates.map((date) => {
                    const d = new Date(date);
                    const dayName = d.toLocaleDateString('th-TH', { weekday: 'short', timeZone: 'Asia/Bangkok' });
                    const dayNum = date.slice(8, 10);
                    return (
                      <th key={date} className="px-2 py-2 text-center font-medium text-gray-500 dark:text-gray-400" style={{ minWidth: 56 }}>
                        <div>{dayName}</div>
                        <div className="text-[10px] text-gray-400">{dayNum}</div>
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 text-center font-medium text-gray-500 dark:text-gray-400" style={{ minWidth: 60 }}>
                    Δ
                  </th>
                  <th className="px-2 py-2 text-center font-medium text-gray-500 dark:text-gray-400" style={{ minWidth: 50 }}>
                    เกินกี่ครั้ง
                  </th>
                  <th className="px-2 py-2 text-center font-medium text-gray-500 dark:text-gray-400" style={{ minWidth: 90 }}>
                    สถานะ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {displayed.map((p) => {
                  const trendType = classifyTrend(p.trendSlope);
                  return (
                    <tr
                      key={p.product_code}
                      onClick={() => openEdit(p)}
                      className={cn(
                        'cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30',
                        p.tracking?.is_tracking && p.tracking.priority === 'urgent' && 'bg-red-50/50 dark:bg-red-900/10',
                      )}
                    >
                      <td className="sticky left-0 bg-white py-2 pr-2 dark:bg-gray-800" style={{ minWidth: 220 }}>
                        <div className="flex items-start gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePin(p.product_code);
                            }}
                            aria-label={p.pinned ? 'unpin' : 'pin'}
                            className={cn(
                              'mt-0.5 shrink-0 rounded p-0.5 transition-colors',
                              p.pinned
                                ? 'text-amber-500 hover:text-amber-600'
                                : 'text-gray-300 hover:text-amber-400 dark:text-gray-600 dark:hover:text-amber-400',
                            )}
                          >
                            <Star className={cn('h-3.5 w-3.5', p.pinned && 'fill-current')} />
                          </button>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1">
                              <p className="truncate text-xs font-medium text-gray-900 dark:text-white">
                                {p.product_name}
                              </p>
                              {p.tracking?.is_tracking && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                                  <Pin className="h-2.5 w-2.5" />
                                  ติดตาม
                                </span>
                              )}
                              {p.tracking?.is_tracking && p.tracking.priority !== 'normal' && (
                                <span className={cn(
                                  'rounded-full px-1.5 py-0.5 text-[9px] font-medium',
                                  PRIORITY_CONFIG[p.tracking.priority].bg,
                                  PRIORITY_CONFIG[p.tracking.priority].text,
                                )}>
                                  {PRIORITY_CONFIG[p.tracking.priority].label}
                                </span>
                              )}
                              {p.tracking && !p.tracking.is_tracking && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                  <CheckCircle2 className="h-2.5 w-2.5" />
                                  ปิดเคส
                                </span>
                              )}
                              <TrendBadge type={trendType} />
                            </div>
                            <p className="truncate text-[10px] text-gray-400">{p.product_code}</p>
                          </div>
                        </div>
                      </td>
                      {allDates.map((date) => {
                        const day = p.days.get(date);
                        if (!day) {
                          return (
                            <td key={date} className="px-2 py-2 text-center text-gray-300 dark:text-gray-600">
                              —
                            </td>
                          );
                        }
                        // POS-only (manual=null) → blue "ยังไม่นับ" chip
                        // so the cell doesn't scream red for a non-issue.
                        if (day.manual_quantity === null) {
                          return (
                            <td key={date} className="px-2 py-2 text-center">
                              <span
                                className="inline-block min-w-[32px] rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                                title="POS มีตัวเลขแต่ยังไม่ได้นับมือ"
                              >
                                ยังไม่นับ
                              </span>
                            </td>
                          );
                        }
                        const diff = day.difference;
                        const isMatch = isEffectivelyZero(diff);
                        const overTol = !isMatch && !isWithinTolerance(diff, day.diff_percent);
                        let cellBg = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';
                        if (overTol) {
                          cellBg = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
                        } else if (!isMatch) {
                          cellBg = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400';
                        }
                        return (
                          <td key={date} className="px-2 py-2 text-center">
                            <span className={cn('inline-block min-w-[32px] rounded-md px-1.5 py-0.5 text-[11px] font-bold', cellBg)}>
                              {isMatch ? '✓' : formatSignedQty(diff)}
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-center">
                        {p.latestDelta === null ? (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        ) : p.latestDelta === 0 ? (
                          <span className="inline-block rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-bold text-gray-500 dark:bg-gray-700/40 dark:text-gray-400">
                            0
                          </span>
                        ) : (
                          <span
                            className={cn(
                              'inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold',
                              p.latestDelta > 0
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                                : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
                            )}
                            title={p.latestDeltaDates ? `เทียบ ${p.latestDeltaDates.from.slice(8, 10)} → ${p.latestDeltaDates.to.slice(8, 10)}` : ''}
                          >
                            {p.latestDelta > 0 ? '+' : ''}
                            {p.latestDelta}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {p.totalOverTolerance > 0 ? (
                          <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-900/40 dark:text-red-400">
                            {p.totalOverTolerance}
                          </span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">0</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <Badge size="sm" variant={p.tracking?.is_tracking ? 'info' : p.tracking ? 'success' : 'default'}>
                          {p.tracking?.is_tracking ? 'ติดตาม' : p.tracking ? 'ปิดเคส' : 'ยังไม่ flag'}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-3 pt-1 text-right text-[10px] text-gray-400">
            แสดง {displayed.length} จาก {products.length} รายการ
          </div>
        </Card>
      )}

      {/* Help modal */}
      {showHelp && (
        <Modal isOpen={showHelp} onClose={() => setShowHelp(false)} title="วิธีใช้งานระบบติดตาม" size="full">
          <div className="space-y-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            <div>
              <h3 className="mb-1 font-semibold text-gray-900 dark:text-white">📌 ระบบนี้ทำอะไร</h3>
              <p>
                แสดงผลต่างสต๊อกของแต่ละสินค้าข้ามวันในเดือนที่เลือก — ดูแนวโน้มได้ในตาเดียว
                ปักหมุดสินค้าที่จับตา flag เป็น tracking item พร้อมโน๊ต/บทสรุป/history
              </p>
            </div>

            <div>
              <h3 className="mb-1 font-semibold text-gray-900 dark:text-white">🎯 วิธีใช้</h3>
              <ol className="list-decimal space-y-1 pl-5">
                <li>กดดาว ⭐ ที่ชื่อสินค้าเพื่อปักหมุด — แถวจะลอยขึ้นบน</li>
                <li>คลิกแถวสินค้า → เปิดฟอร์ม flag/แก้ไข + history ของรายการนั้น</li>
                <li>กรอกเหตุผล + Priority + สิ่งที่ต้องติดตาม</li>
                <li>เมื่อแก้ปัญหาได้ → uncheck "กำลังติดตาม" + เขียนบทสรุป → ปิดเคส</li>
              </ol>
            </div>

            <div>
              <h3 className="mb-1 font-semibold text-gray-900 dark:text-white">🎨 รหัสสีในตาราง</h3>
              <ul className="space-y-1 text-xs">
                <li><span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">✓</span> = ตรงเป๊ะ</li>
                <li><span className="rounded bg-yellow-100 px-1.5 py-0.5 font-medium text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400">+0.3</span> = ในเกณฑ์ (≤5% และ ≤0.4 ขวด)</li>
                <li><span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">-2</span> = เกินเกณฑ์</li>
                <li><span className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">ยังไม่นับ</span> = POS มีตัวเลข แต่นับมือยังไม่ครบ</li>
                <li><span className="text-gray-400">—</span> = ไม่มี comparison วันนั้น</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-1 font-semibold text-gray-900 dark:text-white">🤖 Auto-flag</h3>
              <p>
                สแกนสินค้าในเดือน หา: ปฏิเสธคำชี้แจง ≥ 1 ครั้ง (priority สูง) หรือ ค้างชี้แจง ≥ 3 ครั้ง (ปกติ)
                — เฉพาะที่ยังไม่ flag
              </p>
            </div>

            <div>
              <h3 className="mb-1 font-semibold text-gray-900 dark:text-white">🔐 สิทธิ์</h3>
              <p>เฉพาะ owner / accountant / manager / hq เท่านั้นที่เข้าได้</p>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={() => setShowHelp(false)}>เข้าใจแล้ว</Button>
          </div>
        </Modal>
      )}

      {/* Edit modal */}
      {editingItem && (
        <Modal
          isOpen={!!editingItem}
          onClose={closeEdit}
          title={editingItem.existing ? 'แก้ไขการติดตาม' : 'เริ่มติดตาม'}
          size="md"
        >
          <div className="space-y-3">
            <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {editingItem.product_name}
              </p>
              <p className="text-xs text-gray-400">{editingItem.product_code}</p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editForm.is_tracking}
                onChange={(e) => setEditForm({ ...editForm, is_tracking: e.target.checked })}
                className="h-4 w-4"
              />
              <span>กำลังติดตาม (uncheck เพื่อปิดเคส)</span>
            </label>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">ระดับความสำคัญ</label>
              <div className="grid grid-cols-4 gap-1">
                {(['low', 'normal', 'high', 'urgent'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setEditForm({ ...editForm, priority: p })}
                    className={cn(
                      'rounded-md py-1.5 text-xs font-medium transition-colors',
                      editForm.priority === p
                        ? `${PRIORITY_CONFIG[p].bg} ${PRIORITY_CONFIG[p].text} ring-1 ring-current`
                        : 'border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800',
                    )}
                  >
                    {PRIORITY_CONFIG[p].label}
                  </button>
                ))}
              </div>
            </div>

            <Textarea
              label="เหตุผลที่ติดตาม"
              value={editForm.reason}
              onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
              rows={2}
              placeholder="เช่น สต๊อกขาดประจำ 5 ครั้งใน 2 สัปดาห์"
            />

            <Textarea
              label="โน๊ต"
              value={editForm.notes}
              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              rows={2}
            />

            <Textarea
              label="ติดตามเรื่องอะไร"
              value={editForm.follow_up_action}
              onChange={(e) => setEditForm({ ...editForm, follow_up_action: e.target.value })}
              rows={2}
              placeholder="เช่น เช็ค CCTV กะดึก, สอบสวนพนักงานชื่อ X"
            />

            {!editForm.is_tracking && (
              <Textarea
                label="บทสรุป (ปิดเคส)"
                value={editForm.resolution_notes}
                onChange={(e) => setEditForm({ ...editForm, resolution_notes: e.target.value })}
                rows={2}
                placeholder="สรุปผลการติดตาม"
              />
            )}

            {/* History timeline (only when editing existing tracked item) */}
            {editingItem.existing && (
              <div className="border-t border-gray-100 pt-3 dark:border-gray-700">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                  <History className="h-3.5 w-3.5" />
                  ประวัติ
                </div>
                {historyEvents === 'loading' ? (
                  <div className="flex justify-center py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  </div>
                ) : historyEvents === null || historyEvents.length === 0 ? (
                  <p className="py-2 text-center text-xs text-gray-400">ไม่มีประวัติ</p>
                ) : (
                  <ul className="space-y-1.5">
                    {historyEvents.map((ev) => (
                      <HistoryRow key={ev.id} ev={ev} />
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={closeEdit}>
                ยกเลิก
              </Button>
              <Button size="sm" onClick={handleSave}>
                บันทึก
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, color, icon: Icon }: { label: string; value: number; color: string; icon: typeof Package }) {
  const colorMap: Record<string, string> = {
    indigo: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20',
    red: 'text-red-600 bg-red-50 dark:bg-red-900/20',
    orange: 'text-orange-600 bg-orange-50 dark:bg-orange-900/20',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20',
    blue: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',
  };
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        <div className={cn('rounded-lg p-1.5', colorMap[color])}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
  color = 'indigo',
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: 'indigo' | 'red' | 'emerald' | 'amber';
}) {
  const colorMap = {
    indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
        active ? colorMap[color] : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700',
      )}
    >
      {label}
    </button>
  );
}

function TrendBadge({ type }: { type: 'worsening' | 'improving' | 'stable' }) {
  if (type === 'worsening') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
        <TrendingUp className="h-2.5 w-2.5" /> แย่ลง
      </span>
    );
  }
  if (type === 'improving') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        <TrendingDown className="h-2.5 w-2.5" /> ดีขึ้น
      </span>
    );
  }
  // stable — no badge to keep the row tidy.
  return null;
}

function HistoryRow({ ev }: { ev: HistoryEvent }) {
  const cfg = ACTION_CONFIG[ev.action] || { label: ev.action, emoji: '•', color: 'text-gray-600' };
  const dt = new Date(ev.created_at);
  const dateStr = `${dt.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })} ${dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
  const reason = (ev.payload?.reason as string) || '';
  const notes = (ev.payload?.notes as string) || '';
  const followUp = (ev.payload?.follow_up_action as string) || '';
  const resolution = (ev.payload?.resolution_notes as string) || '';

  return (
    <li className="flex gap-2 rounded-md bg-gray-50 px-2 py-1.5 text-xs dark:bg-gray-800/50">
      <span>{cfg.emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className={cn('font-medium', cfg.color)}>{cfg.label}</span>
          {ev.created_by_name && (
            <span className="text-[10px] text-gray-500">โดย {ev.created_by_name}</span>
          )}
          <span className="ml-auto text-[10px] text-gray-400">{dateStr}</span>
        </div>
        {reason && <p className="mt-0.5 text-gray-600 dark:text-gray-300"><span className="text-[10px] text-gray-400">เหตุผล:</span> {reason}</p>}
        {notes && <p className="mt-0.5 text-gray-600 dark:text-gray-300"><span className="text-[10px] text-gray-400">โน๊ต:</span> {notes}</p>}
        {followUp && <p className="mt-0.5 text-gray-600 dark:text-gray-300"><span className="text-[10px] text-gray-400">ติดตาม:</span> {followUp}</p>}
        {resolution && <p className="mt-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"><span className="text-[10px]">บทสรุป:</span> {resolution}</p>}
      </div>
    </li>
  );
}
