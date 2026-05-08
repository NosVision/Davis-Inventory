'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Warehouse,
  Clock,
  Package,
  BoxSelect,
  Store as StoreIcon,
  ChevronDown,
  ChevronUp,
  Search,
  Eye,
  Check,
  X,
  Camera,
  Loader2,
  RefreshCw,
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Hand,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { useRealtime } from '@/hooks/use-realtime';
import { useActionCardClaims } from '@/hooks/use-action-card-claims';
import { formatThaiDateTime } from '@/lib/utils/format';
import { todayBangkok, startOfTodayBangkokISO, daysAgoBangkokISO } from '@/lib/utils/date';
import { PhotoUpload } from '@/components/ui/photo-upload';
import { toast } from '@/components/ui';
import type { Store } from '@/types/database';
import {
  notifyChatTransferReceived,
  notifyChatTransferRejected,
  notifyChatHqWithdrawal,
} from '@/lib/chat/transfer-bot-client';
import { ReceiveHistoryView } from './_components/receive-history-view';
import type { ReceiveReportData } from './_components/receive-report-pdf';

// ==========================================
// Types
// ==========================================

interface TransferWithItems {
  id: string;
  transfer_code: string;
  from_store_id: string;
  from_store_name: string;
  deposit_id: string | null;
  product_name: string | null;
  customer_name: string | null;
  deposit_code: string | null;
  quantity: number | null;
  status: string;
  requested_by: string | null;
  requested_by_name: string | null;
  notes: string | null;
  photo_url: string | null;
  deposit_photo_url: string | null;
  rejection_reason: string | null;
  created_at: string;
}

interface TransferBatchGroup {
  // Composite group key — same transfer_code can appear across multiple
  // from_store_ids (legacy bulk-imports give the same code to several
  // stores), so we split each (transfer_code, from_store_id) into its
  // own card. The key is what the page React-keys / chat-claim-locks
  // against; transfer_code is still the human-readable label.
  group_key: string;
  transfer_code: string;
  from_store_id: string;
  from_store_name: string;
  items: TransferWithItems[];
  created_at: string;
}

interface HqDepositItem {
  id: string;
  transfer_id: string | null;
  deposit_id: string | null;
  from_store_id: string | null;
  from_store_name: string;
  product_name: string | null;
  customer_name: string | null;
  deposit_code: string | null;
  category: string | null;
  quantity: number | null;
  status: string;
  received_by: string | null;
  received_by_name: string | null;
  received_photo_url: string | null;
  received_at: string;
  received_session_id: string | null;
  withdrawn_by: string | null;
  withdrawn_by_name: string | null;
  withdrawal_notes: string | null;
  withdrawn_at: string | null;
  notes: string | null;
  // Per-bottle remaining_percent for this row's deposit_id, ordered by
  // bottle_no. A multi-bottle deposit (e.g. customer deposited 3 bottles
  // under one code, only some are partly drunk) shows up as e.g.
  // [100, 80, 50]. Pulled by loadHistoryForDate, null in other loaders.
  remaining_percents: number[] | null;
  created_at: string;
}

interface BranchSummary {
  storeId: string;
  storeName: string;
  pending: number;
  received: number;
}

type TabId = 'pending' | 'received' | 'history' | 'withdrawn';

// Convert the in-app HqDepositItem[] for a given day into the
// serializable shape the PDF generator expects. Mirrors the grouping
// the on-screen ReceiveHistoryView uses so the PDF and the screen
// always agree.
function buildReportData(
  date: string,
  items: HqDepositItem[],
  hqName: string,
): ReceiveReportData {
  const sessionMap = new Map<string, {
    session_id: string;
    received_at: string;
    received_by_name: string | null;
    from_store_name: string;
    items: HqDepositItem[];
  }>();
  for (const it of items) {
    const sid = it.received_session_id || `solo:${it.id}`;
    const cur = sessionMap.get(sid);
    if (cur) cur.items.push(it);
    else sessionMap.set(sid, {
      session_id: sid,
      received_at: it.received_at,
      received_by_name: it.received_by_name,
      from_store_name: it.from_store_name,
      items: [it],
    });
  }
  const sortedSessions = Array.from(sessionMap.values()).sort(
    (a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime(),
  );

  const storeMap = new Map<string, ReceiveReportData['stores'][number]>();
  for (const s of sortedSessions) {
    const key = s.from_store_name;
    const existing = storeMap.get(key);
    const sessionDto = {
      session_id: s.session_id,
      received_at: s.received_at,
      received_by_name: s.received_by_name,
      items: s.items.map((it) => ({
        product_name: it.product_name,
        customer_name: it.customer_name,
        deposit_code: it.deposit_code,
        quantity: it.quantity,
        remaining_percents: it.remaining_percents,
      })),
    };
    if (existing) existing.sessions.push(sessionDto);
    else storeMap.set(key, { from_store_name: key, sessions: [sessionDto] });
  }

  const receiverNames = Array.from(
    new Set(items.map((i) => i.received_by_name).filter(Boolean) as string[]),
  );

  return {
    date,
    date_label: new Intl.DateTimeFormat('th-TH', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(`${date}T12:00:00+07:00`)),
    hq_name: hqName,
    total_items: items.length,
    total_sessions: sortedSessions.length,
    receiver_names: receiverNames,
    stores: Array.from(storeMap.values()).sort((a, b) =>
      a.from_store_name.localeCompare(b.from_store_name, 'th'),
    ),
  };
}

// ==========================================
// Main Component
// ==========================================

export default function HqWarehousePage() {
  const { user } = useAuthStore();
  const t = useTranslations('hqWarehouse');
  const unknownBranch = t('unknownBranch');
  const [stores, setStores] = useState<Store[]>([]);
  const mountedRef = useRef(true);

  // Data State
  const [pendingTransfers, setPendingTransfers] = useState<TransferWithItems[]>([]);
  const [receivedItems, setReceivedItems] = useState<HqDepositItem[]>([]);
  const [withdrawnItems, setWithdrawnItems] = useState<HqDepositItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // UI State
  const [activeTab, setActiveTab] = useState<TabId>('pending');
  const [showBranchSummary, setShowBranchSummary] = useState(false);
  const [filterBranch, setFilterBranch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [withdrawnDateFilter, setWithdrawnDateFilter] = useState<'today' | 'week' | 'all'>('today');

  // Modal State
  const [selectedTransfer, setSelectedTransfer] = useState<TransferWithItems | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  // Detail panel enrichment fetched lazily on modal open: per-bottle
  // remaining_percent + the original branch-side deposit photo (the one
  // taken when the customer first dropped the bottle off, not the
  // transfer photo). Reset whenever the modal closes or the selection
  // changes.
  const [detailExtras, setDetailExtras] = useState<{
    bottles: { bottle_no: number; remaining_percent: number }[];
    deposit_photo_url: string | null;
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmStep, setConfirmStep] = useState(1);
  const [confirmPhotoUrl, setConfirmPhotoUrl] = useState<string | null>(null);
  const [confirmNotes, setConfirmNotes] = useState('');
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);

  // Reject Modal State
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingTransfer, setRejectingTransfer] = useState<TransferWithItems | null>(null);
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  // Withdraw Modal State
  const [selectedHqDeposit, setSelectedHqDeposit] = useState<HqDepositItem | null>(null);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawNotes, setWithdrawNotes] = useState('');
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);

  // Received tab: view mode + multi-select
  const [receivedViewMode, setReceivedViewMode] = useState<'card' | 'table'>('card');
  const [selectedReceivedIds, setSelectedReceivedIds] = useState<Set<string>>(new Set());
  const [showBulkWithdrawModal, setShowBulkWithdrawModal] = useState(false);
  const [bulkWithdrawNotes, setBulkWithdrawNotes] = useState('');
  const [bulkWithdrawSubmitting, setBulkWithdrawSubmitting] = useState(false);

  // Batch Confirm Modal State (receive all items in a batch)
  const [showBatchConfirmModal, setShowBatchConfirmModal] = useState(false);
  const [batchConfirmGroup, setBatchConfirmGroup] = useState<TransferBatchGroup | null>(null);
  const [batchConfirmStep, setBatchConfirmStep] = useState(1);
  const [batchConfirmPhotoUrl, setBatchConfirmPhotoUrl] = useState<string | null>(null);
  const [batchConfirmNotes, setBatchConfirmNotes] = useState('');
  const [batchConfirmSubmitting, setBatchConfirmSubmitting] = useState(false);

  // Photo Modal State
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);

  // Branch group expand state
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());
  const toggleBranch = (storeId: string) => {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });
  };

  // Partial-receipt state — per batch_code, the set of item ids the
  // owner has ticked. When empty we treat "เลือกทั้งหมด" as the implicit
  // selection. Cleared after a successful receive.
  const [pendingSelection, setPendingSelection] = useState<Map<string, Set<string>>>(new Map());

  // Per-batch local search query — filters items inside one expanded
  // batch only, separate from the page-level search box. Owners with a
  // 30-item batch can find a specific bottle without affecting which
  // batches are visible at the top level.
  const [batchSearch, setBatchSearch] = useState<Map<string, string>>(new Map());

  // History tab — date-scoped fetch of confirmed receipts (ALL statuses,
  // not just awaiting_withdrawal) so the report can show items that have
  // since been withdrawn too. Fresh array on every date pick.
  const [historyDate, setHistoryDate] = useState<string>(() => todayBangkok());
  const [historyData, setHistoryData] = useState<HqDepositItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Get central store(s) for filtering
  const centralStores = useMemo(
    () => stores.filter((s) => s.is_central),
    [stores]
  );
  const centralStoreIds = useMemo(
    () => centralStores.map((s) => s.id),
    [centralStores]
  );
  // Live map of who has claimed which transfer_code in chat. Transfer
  // cards live in the central store's chat room (the receiving HQ
  // chat). When there are multiple central stores we subscribe to the
  // first — typical setups have exactly one HQ. The hook handles the
  // transfer_code → reference_id fallback internally.
  const chatClaims = useActionCardClaims(centralStoreIds[0] || null);

  // Non-central stores for branch summary
  const branchStores = useMemo(
    () => stores.filter((s) => !s.is_central && s.active),
    [stores]
  );

  // ==========================================
  // Fetch Stores
  // ==========================================

  const fetchStores = useCallback(async () => {
    const supabase = createClient();
    // owner/hq/accountant see all stores
    const { data } = await supabase
      .from('stores')
      .select('*')
      .eq('active', true)
      .order('store_name');
    if (data && mountedRef.current) setStores(data);
  }, []);

  // ==========================================
  // Data Loading
  // ==========================================

  const loadPendingTransfers = useCallback(async () => {
    if (centralStoreIds.length === 0) return;
    const supabase = createClient();

    const { data } = await supabase
      .from('transfers')
      .select(`
        id, transfer_code, rejection_reason, from_store_id, deposit_id, product_name, quantity,
        status, requested_by, notes, photo_url, created_at
      `)
      .in('to_store_id', centralStoreIds)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (!data || !mountedRef.current) return;

    // Resolve store names and requester names
    const storeMap = new Map(stores.map((s) => [s.id, s.store_name]));
    const userIds = [...new Set(data.map((t) => t.requested_by).filter(Boolean))] as string[];
    let userMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, username')
        .in('id', userIds);
      if (profiles) {
        userMap = new Map(profiles.map((p) => [p.id, p.display_name || p.username]));
      }
    }

    // Resolve deposit info (incl. photo_url so the HQ row can show the
    // original deposit photo without opening the detail modal).
    const depositIds = data.map((t) => t.deposit_id).filter(Boolean) as string[];
    let depositMap = new Map<string, { customer_name: string; deposit_code: string; photo_url: string | null }>();
    if (depositIds.length > 0) {
      const { data: deposits } = await supabase
        .from('deposits')
        .select('id, customer_name, deposit_code, photo_url')
        .in('id', depositIds);
      if (deposits) {
        depositMap = new Map(deposits.map((d) => [d.id, { customer_name: d.customer_name, deposit_code: d.deposit_code, photo_url: d.photo_url ?? null }]));
      }
    }

    const items: TransferWithItems[] = data.map((t) => {
      const depositInfo = t.deposit_id ? depositMap.get(t.deposit_id) : null;
      return {
        id: t.id,
        transfer_code: t.transfer_code || t.id.slice(0, 8).toUpperCase(),
        from_store_id: t.from_store_id,
        from_store_name: storeMap.get(t.from_store_id) || unknownBranch,
        deposit_id: t.deposit_id,
        product_name: t.product_name,
        customer_name: depositInfo?.customer_name || null,
        deposit_code: depositInfo?.deposit_code || null,
        quantity: t.quantity,
        status: t.status,
        requested_by: t.requested_by,
        requested_by_name: t.requested_by ? (userMap.get(t.requested_by) || null) : null,
        notes: t.notes,
        photo_url: t.photo_url,
        deposit_photo_url: depositInfo?.photo_url ?? null,
        rejection_reason: t.rejection_reason || null,
        created_at: t.created_at,
      };
    });

    if (mountedRef.current) setPendingTransfers(items);
  }, [centralStoreIds, stores]);

  const loadReceivedItems = useCallback(async () => {
    if (centralStoreIds.length === 0) return;
    const supabase = createClient();

    // The previous version of this function ran an auto-repair pass that
    // re-inserted any confirmed transfer missing an hq_deposits row. Its
    // dedup query (`.in('transfer_id', [...709 UUIDs])`) silently
    // overflowed PostgREST's URL length limit on this dataset, so every
    // page load thought all 709 confirmed transfers were still orphans
    // and inserted another batch — creating 2,836 ghost rows with NULL
    // product_name visible in /history. Migration 00044 cleans the
    // ghosts and adds a UNIQUE index on transfer_id; the receive flow
    // (single + batch) already creates the row at confirm time, so this
    // safety net is no longer needed.

    // --- Now load hq_deposits normally ---
    const { data, error } = await supabase
      .from('hq_deposits')
      .select('*')
      .eq('status', 'awaiting_withdrawal')
      .order('received_at', { ascending: false });

    if (error) {
      console.error('[HQ] loadReceivedItems error:', error);
      return;
    }
    if (!data || !mountedRef.current) return;

    const storeMap = new Map(stores.map((s) => [s.id, s.store_name]));
    const userIds = [...new Set([
      ...data.map((d) => d.received_by),
    ].filter(Boolean))] as string[];
    let userMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, username')
        .in('id', userIds);
      if (profiles) {
        userMap = new Map(profiles.map((p) => [p.id, p.display_name || p.username]));
      }
    }

    const items: HqDepositItem[] = data.map((d) => ({
      ...d,
      from_store_name: storeMap.get(d.from_store_id || '') || unknownBranch,
      received_by_name: d.received_by ? (userMap.get(d.received_by) || null) : null,
      withdrawn_by_name: null,
      remaining_percents: null,
    }));

    if (mountedRef.current) setReceivedItems(items);
  }, [centralStoreIds, stores]);

  const loadWithdrawnItems = useCallback(async () => {
    const supabase = createClient();

    const { data } = await supabase
      .from('hq_deposits')
      .select('*')
      .eq('status', 'withdrawn')
      .order('withdrawn_at', { ascending: false });

    if (!data || !mountedRef.current) return;

    const storeMap = new Map(stores.map((s) => [s.id, s.store_name]));
    const userIds = [...new Set([
      ...data.map((d) => d.received_by),
      ...data.map((d) => d.withdrawn_by),
    ].filter(Boolean))] as string[];
    let userMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, username')
        .in('id', userIds);
      if (profiles) {
        userMap = new Map(profiles.map((p) => [p.id, p.display_name || p.username]));
      }
    }

    const items: HqDepositItem[] = data.map((d) => ({
      ...d,
      from_store_name: storeMap.get(d.from_store_id || '') || unknownBranch,
      received_by_name: d.received_by ? (userMap.get(d.received_by) || null) : null,
      withdrawn_by_name: d.withdrawn_by ? (userMap.get(d.withdrawn_by) || null) : null,
      remaining_percents: null,
    }));

    if (mountedRef.current) setWithdrawnItems(items);
  }, [stores]);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadPendingTransfers(),
        loadReceivedItems(),
        loadWithdrawnItems(),
      ]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [loadPendingTransfers, loadReceivedItems, loadWithdrawnItems]);

  // History tab: pull every hq_deposit whose received_at falls within the
  // selected Bangkok day. Includes items already withdrawn so the daily
  // report stays complete even after an owner empties the warehouse.
  const loadHistoryForDate = useCallback(async (date: string) => {
    if (centralStoreIds.length === 0) return;
    setHistoryLoading(true);
    try {
      const supabase = createClient();
      // Bangkok day window in UTC. received_at is stored UTC; converting
      // here keeps the comparison in the index's collation.
      const startIso = `${date}T00:00:00+07:00`;
      const endIso = `${date}T23:59:59.999+07:00`;

      const { data, error } = await supabase
        .from('hq_deposits')
        .select('*')
        .gte('received_at', startIso)
        .lte('received_at', endIso)
        .order('received_at', { ascending: true });
      if (error) throw error;

      const storeMap = new Map(stores.map((s) => [s.id, s.store_name]));
      const userIds = [...new Set([
        ...(data || []).map((d) => d.received_by),
      ].filter(Boolean))] as string[];
      let userMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name, username')
          .in('id', userIds);
        if (profiles) {
          userMap = new Map(profiles.map((p) => [p.id, p.display_name || p.username]));
        }
      }

      // Pull per-bottle remaining_percent for each deposit_id. Keep the
      // array (rather than averaging) so a multi-bottle deposit with
      // partly-drunk bottles renders as "100%, 80%, 50%" instead of
      // hiding the variance behind an average.
      const depositIds = [...new Set(
        (data || []).map((d) => d.deposit_id).filter(Boolean) as string[],
      )];
      let pctMap = new Map<string, number[]>();
      if (depositIds.length > 0) {
        const { data: bottles } = await supabase
          .from('deposit_bottles')
          .select('deposit_id, bottle_no, remaining_percent')
          .in('deposit_id', depositIds)
          .order('bottle_no', { ascending: true });
        if (bottles) {
          const grouped = new Map<string, number[]>();
          for (const b of bottles) {
            if (!b.deposit_id || b.remaining_percent === null) continue;
            const arr = grouped.get(b.deposit_id) || [];
            arr.push(Math.round(Number(b.remaining_percent)));
            grouped.set(b.deposit_id, arr);
          }
          pctMap = grouped;
        }
      }

      const items: HqDepositItem[] = (data || []).map((d) => ({
        ...d,
        from_store_name: storeMap.get(d.from_store_id || '') || unknownBranch,
        received_by_name: d.received_by ? (userMap.get(d.received_by) || null) : null,
        withdrawn_by_name: null,
        remaining_percents: d.deposit_id ? (pctMap.get(d.deposit_id) ?? null) : null,
      }));
      if (mountedRef.current) setHistoryData(items);
    } finally {
      if (mountedRef.current) setHistoryLoading(false);
    }
  }, [centralStoreIds, stores, unknownBranch]);

  // Refetch history whenever date or store list changes while on the tab.
  useEffect(() => {
    if (activeTab === 'history' && stores.length > 0) {
      loadHistoryForDate(historyDate);
    }
  }, [activeTab, historyDate, stores.length, loadHistoryForDate]);

  // Load deposit_bottles + the original branch-side deposit photo when
  // the detail modal opens. Resets on close so a stale fetch from a
  // previous transfer doesn't leak into the next one.
  useEffect(() => {
    if (!showDetailModal || !selectedTransfer?.deposit_id) {
      setDetailExtras(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    const supabase = createClient();
    (async () => {
      const [bottlesRes, depositRes] = await Promise.all([
        supabase
          .from('deposit_bottles')
          .select('bottle_no, remaining_percent')
          .eq('deposit_id', selectedTransfer.deposit_id)
          .order('bottle_no', { ascending: true }),
        supabase
          .from('deposits')
          .select('photo_url')
          .eq('id', selectedTransfer.deposit_id)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const bottles = (bottlesRes.data || [])
        .filter((b) => b.remaining_percent !== null)
        .map((b) => ({
          bottle_no: b.bottle_no,
          remaining_percent: Math.round(Number(b.remaining_percent)),
        }));
      setDetailExtras({
        bottles,
        deposit_photo_url: depositRes.data?.photo_url || null,
      });
      setDetailLoading(false);
    })();
    return () => { cancelled = true; };
  }, [showDetailModal, selectedTransfer]);

  useEffect(() => {
    mountedRef.current = true;
    fetchStores();
    return () => { mountedRef.current = false; };
  }, [fetchStores]);

  useEffect(() => {
    if (stores.length > 0) {
      loadAllData();
    }
  }, [stores.length, loadAllData]);

  // Realtime subscriptions
  const realtimeCallback = useCallback(() => {
    loadAllData();
  }, [loadAllData]);

  useRealtime({
    table: 'transfers',
    onInsert: realtimeCallback,
    onUpdate: realtimeCallback,
  });

  useRealtime({
    table: 'hq_deposits',
    onInsert: realtimeCallback,
    onUpdate: realtimeCallback,
  });

  // ==========================================
  // Branch Summary
  // ==========================================

  const branchSummaryData = useMemo<BranchSummary[]>(() => {
    return branchStores.map((store) => ({
      storeId: store.id,
      storeName: store.store_name,
      pending: pendingTransfers.filter((t) => t.from_store_id === store.id).length,
      received: receivedItems.filter((r) => r.from_store_id === store.id).length,
    })).filter((b) => b.pending > 0 || b.received > 0);
  }, [branchStores, pendingTransfers, receivedItems]);

  // ==========================================
  // Summary Counts
  // ==========================================

  const summary = useMemo(() => ({
    pending: pendingTransfers.length,
    received: receivedItems.length,
    withdrawn: withdrawnItems.length,
  }), [pendingTransfers, receivedItems, withdrawnItems]);

  // ==========================================
  // Filtered Lists
  // ==========================================

  const filteredPending = useMemo(() => {
    let result = pendingTransfers;
    if (filterBranch) result = result.filter((t) => t.from_store_id === filterBranch);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t) =>
        t.transfer_code.toLowerCase().includes(q) ||
        t.from_store_name.toLowerCase().includes(q) ||
        t.product_name?.toLowerCase().includes(q) ||
        t.customer_name?.toLowerCase().includes(q) ||
        t.deposit_code?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [pendingTransfers, filterBranch, searchQuery]);

  // Group pending transfers by transfer_code (batch)
  const pendingByBatch = useMemo(() => {
    // Group by (transfer_code, from_store_id) so a transfer code that
    // exists across multiple branches lands on multiple cards — one per
    // source. Otherwise the items from later stores appeared mixed
    // under the first store's name and looked "missing" to anyone who
    // expected to see their own branch's portion.
    const grouped = new Map<string, TransferBatchGroup>();
    for (const t of filteredPending) {
      const key = `${t.transfer_code}::${t.from_store_id}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.items.push(t);
      } else {
        grouped.set(key, {
          group_key: key,
          transfer_code: t.transfer_code,
          from_store_id: t.from_store_id,
          from_store_name: t.from_store_name,
          items: [t],
          created_at: t.created_at,
        });
      }
    }
    const batches = Array.from(grouped.values());
    batches.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return batches;
  }, [filteredPending]);

  const filteredReceived = useMemo(() => {
    let result = receivedItems;
    if (filterBranch) result = result.filter((i) => i.from_store_id === filterBranch);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((i) =>
        i.product_name?.toLowerCase().includes(q) ||
        i.customer_name?.toLowerCase().includes(q) ||
        i.deposit_code?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [receivedItems, filterBranch, searchQuery]);

  const filteredWithdrawn = useMemo(() => {
    let result = withdrawnItems;
    if (filterBranch) result = result.filter((i) => i.from_store_id === filterBranch);

    if (withdrawnDateFilter === 'today') {
      const todayStr = todayBangkok(); // "YYYY-MM-DD"
      result = result.filter((i) => {
        if (!i.withdrawn_at) return false;
        // Format withdrawn_at in Bangkok timezone to compare date strings
        const dStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok' }).format(new Date(i.withdrawn_at));
        return dStr === todayStr;
      });
    } else if (withdrawnDateFilter === 'week') {
      const weekAgoISO = daysAgoBangkokISO(7);
      result = result.filter((i) => i.withdrawn_at && new Date(i.withdrawn_at) >= new Date(weekAgoISO));
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((i) =>
        i.product_name?.toLowerCase().includes(q) ||
        i.customer_name?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [withdrawnItems, filterBranch, withdrawnDateFilter, searchQuery]);

  // ==========================================
  // Actions
  // ==========================================

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await loadAllData();
      toast({ type: 'success', title: t('refreshSuccess') });
    } finally {
      setIsRefreshing(false);
    }
  };

  const openConfirmModal = (transfer: TransferWithItems) => {
    setSelectedTransfer(transfer);
    setConfirmStep(1);
    setConfirmPhotoUrl(null);
    setConfirmNotes('');
    setShowConfirmModal(true);
  };

  const submitConfirmTransfer = async () => {
    if (!selectedTransfer || !confirmPhotoUrl || !user) return;
    setConfirmSubmitting(true);

    try {
      const supabase = createClient();

      // 1. Update transfer status to confirmed
      const { error: transferError } = await supabase
        .from('transfers')
        .update({
          status: 'confirmed',
          confirmed_by: user.id,
          confirm_photo_url: confirmPhotoUrl,
        })
        .eq('id', selectedTransfer.id);

      if (transferError) throw transferError;

      // 2. Create hq_deposit record. Single-item receipt still gets its
      //    own session_id so the history view can render this as one
      //    session of size 1.
      const sessionId = crypto.randomUUID();
      const { error: hqError } = await supabase
        .from('hq_deposits')
        .insert({
          transfer_id: selectedTransfer.id,
          deposit_id: selectedTransfer.deposit_id,
          from_store_id: selectedTransfer.from_store_id,
          product_name: selectedTransfer.product_name,
          customer_name: selectedTransfer.customer_name,
          deposit_code: selectedTransfer.deposit_code,
          quantity: selectedTransfer.quantity,
          status: 'awaiting_withdrawal',
          received_by: user.id,
          received_photo_url: confirmPhotoUrl,
          received_session_id: sessionId,
          notes: confirmNotes || null,
        });

      if (hqError) throw hqError;

      // 3. Update original deposit status to transferred_out
      if (selectedTransfer.deposit_id) {
        await supabase
          .from('deposits')
          .update({ status: 'transferred_out' })
          .eq('id', selectedTransfer.deposit_id);
      }

      toast({ type: 'success', title: t('receiveSuccess') });

      // ส่ง system message กลับไปห้องสาขาต้นทาง
      notifyChatTransferReceived(selectedTransfer.from_store_id, {
        transfer_code: selectedTransfer.transfer_code,
        item_count: 1,
        received_by_name: user.displayName || user.username || 'HQ Staff',
      });

      setShowConfirmModal(false);
      setSelectedTransfer(null);
      await loadAllData();
    } catch (err) {
      console.error('Confirm error:', err);
      toast({ type: 'error', title: t('receiveError') });
    } finally {
      setConfirmSubmitting(false);
    }
  };

  const openRejectModal = (transfer: TransferWithItems) => {
    setRejectingTransfer(transfer);
    setRejectReason('');
    setShowRejectModal(true);
  };

  const submitRejectTransfer = async () => {
    if (!rejectingTransfer || !rejectReason.trim()) return;

    setRejectSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('transfers')
        .update({ status: 'rejected', rejection_reason: rejectReason.trim() })
        .eq('id', rejectingTransfer.id);

      if (error) throw error;

      // Revert deposit status back to expired
      if (rejectingTransfer.deposit_id) {
        await supabase
          .from('deposits')
          .update({ status: 'expired' })
          .eq('id', rejectingTransfer.deposit_id)
          .eq('status', 'transfer_pending');
      }

      toast({ type: 'success', title: t('rejectSuccess') });

      // ส่ง system message กลับไปห้องสาขาต้นทาง
      notifyChatTransferRejected(rejectingTransfer.from_store_id, {
        transfer_code: rejectingTransfer.transfer_code,
        product_name: rejectingTransfer.product_name || 'Product',
        rejected_by_name: user?.displayName || user?.username || 'HQ Staff',
        reason: rejectReason.trim(),
      });

      setShowRejectModal(false);
      setRejectingTransfer(null);
      await loadAllData();
    } catch {
      toast({ type: 'error', title: t('rejectError') });
    } finally {
      setRejectSubmitting(false);
    }
  };

  const openBatchConfirmModal = (batch: TransferBatchGroup) => {
    setBatchConfirmGroup(batch);
    setBatchConfirmStep(1);
    setBatchConfirmPhotoUrl(null);
    setBatchConfirmNotes('');
    setShowBatchConfirmModal(true);
  };

  const submitBatchConfirmTransfer = async () => {
    if (!batchConfirmGroup || !batchConfirmPhotoUrl || !user) return;
    setBatchConfirmSubmitting(true);

    try {
      const supabase = createClient();
      // Honour any partial selection captured in the pending tab. Empty
      // set => receive every item in the batch (the modal's default
      // behaviour). Anything else => only the ticked items get marked
      // received; the rest stay pending for a later session.
      const selected = pendingSelection.get(batchConfirmGroup.group_key);
      const itemsToReceive =
        selected && selected.size > 0
          ? batchConfirmGroup.items.filter((t) => selected.has(t.id))
          : batchConfirmGroup.items;

      // One session id for the whole receive action so the history view
      // can group these items back together.
      const sessionId = crypto.randomUUID();

      for (const transfer of itemsToReceive) {
        // 1. Update transfer status to confirmed
        const { error: transferError } = await supabase
          .from('transfers')
          .update({
            status: 'confirmed',
            confirmed_by: user.id,
            confirm_photo_url: batchConfirmPhotoUrl,
          })
          .eq('id', transfer.id);

        if (transferError) throw transferError;

        // 2. Create hq_deposit record
        const { error: hqError } = await supabase
          .from('hq_deposits')
          .insert({
            transfer_id: transfer.id,
            deposit_id: transfer.deposit_id,
            from_store_id: transfer.from_store_id,
            product_name: transfer.product_name,
            customer_name: transfer.customer_name,
            deposit_code: transfer.deposit_code,
            quantity: transfer.quantity,
            status: 'awaiting_withdrawal',
            received_by: user.id,
            received_photo_url: batchConfirmPhotoUrl,
            received_session_id: sessionId,
            notes: batchConfirmNotes || null,
          });

        if (hqError) throw hqError;

        // 3. Update original deposit status
        if (transfer.deposit_id) {
          await supabase
            .from('deposits')
            .update({ status: 'transferred_out' })
            .eq('id', transfer.deposit_id);
        }
      }

      toast({ type: 'success', title: t('receiveAllSuccess'), message: t('receiveAllSuccessMsg', { count: itemsToReceive.length, code: batchConfirmGroup.transfer_code }) });

      // ส่ง system message กลับไปห้องสาขาต้นทาง
      notifyChatTransferReceived(itemsToReceive[0].from_store_id, {
        transfer_code: batchConfirmGroup.transfer_code,
        item_count: itemsToReceive.length,
        received_by_name: user?.displayName || user?.username || 'HQ Staff',
      });

      // Clear partial selection for this batch — the un-selected items
      // (if any) stay in the tab as a fresh "remaining" batch.
      setPendingSelection((prev) => {
        if (!prev.has(batchConfirmGroup.group_key)) return prev;
        const next = new Map(prev);
        next.delete(batchConfirmGroup.group_key);
        return next;
      });

      setShowBatchConfirmModal(false);
      setBatchConfirmGroup(null);
      await loadAllData();
    } catch (err) {
      console.error('Batch confirm error:', err);
      toast({ type: 'error', title: t('receiveError') });
    } finally {
      setBatchConfirmSubmitting(false);
    }
  };

  const openWithdrawModal = (item: HqDepositItem) => {
    setSelectedHqDeposit(item);
    setWithdrawNotes('');
    setShowWithdrawModal(true);
  };

  // ----- Multi-select helpers for received tab -----
  const canWithdraw = user?.role === 'owner' || user?.role === 'hq';

  const toggleReceivedSelection = (id: string) => {
    setSelectedReceivedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearReceivedSelection = () => setSelectedReceivedIds(new Set());

  // Selected items (derived from current filtered list to avoid stale refs)
  const selectedReceivedItems = useMemo(
    () => filteredReceived.filter((i) => selectedReceivedIds.has(i.id)),
    [filteredReceived, selectedReceivedIds],
  );

  const allFilteredReceivedSelected =
    filteredReceived.length > 0 &&
    filteredReceived.every((i) => selectedReceivedIds.has(i.id));

  const toggleSelectAllReceived = () => {
    if (allFilteredReceivedSelected) {
      clearReceivedSelection();
    } else {
      setSelectedReceivedIds(new Set(filteredReceived.map((i) => i.id)));
    }
  };

  // Clear selection when leaving the received tab or when the filtered set changes
  useEffect(() => {
    if (activeTab !== 'received') clearReceivedSelection();
  }, [activeTab]);

  useEffect(() => {
    // Drop any selected ids that no longer exist in the filtered view
    setSelectedReceivedIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(filteredReceived.map((i) => i.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [filteredReceived]);

  const openBulkWithdrawModal = () => {
    if (selectedReceivedItems.length === 0) return;
    setBulkWithdrawNotes('');
    setShowBulkWithdrawModal(true);
  };

  const submitBulkWithdraw = async () => {
    if (selectedReceivedItems.length === 0 || !user) return;
    setBulkWithdrawSubmitting(true);

    try {
      const supabase = createClient();
      const nowIso = new Date().toISOString();
      const ids = selectedReceivedItems.map((i) => i.id);

      const { error } = await supabase
        .from('hq_deposits')
        .update({
          status: 'withdrawn',
          withdrawn_by: user.id,
          withdrawal_notes: bulkWithdrawNotes || null,
          withdrawn_at: nowIso,
        })
        .in('id', ids);

      if (error) throw error;

      toast({
        type: 'success',
        title: t('bulkWithdrawSuccess'),
        message: t('bulkWithdrawSuccessMsg', { count: selectedReceivedItems.length }),
      });

      // ส่ง system message ให้ทุกสาขาต้นทางที่เกี่ยวข้อง (deduped)
      const centralId = centralStoreIds[0];
      if (centralId) {
        const announced = new Set<string>();
        for (const item of selectedReceivedItems) {
          const key = `${item.from_store_id || ''}:${item.product_name || ''}`;
          if (announced.has(key)) continue;
          announced.add(key);
          notifyChatHqWithdrawal(centralId, {
            product_name: item.product_name || 'Product',
            customer_name: item.customer_name,
            from_store_name: item.from_store_name,
            withdrawn_by_name: user?.displayName || user?.username || 'HQ Staff',
            notes: bulkWithdrawNotes || null,
          });
        }
      }

      setShowBulkWithdrawModal(false);
      clearReceivedSelection();
      await loadAllData();
    } catch (err) {
      console.error('Bulk withdraw error:', err);
      toast({ type: 'error', title: t('withdrawError') });
    } finally {
      setBulkWithdrawSubmitting(false);
    }
  };

  const submitWithdraw = async () => {
    if (!selectedHqDeposit || !user) return;
    setWithdrawSubmitting(true);

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('hq_deposits')
        .update({
          status: 'withdrawn',
          withdrawn_by: user.id,
          withdrawal_notes: withdrawNotes || null,
          withdrawn_at: new Date().toISOString(),
        })
        .eq('id', selectedHqDeposit.id);

      if (error) throw error;

      toast({ type: 'success', title: t('withdrawSuccess') });

      // ส่ง system message ไปห้อง HQ + ห้องสาขาต้นทาง
      const centralId = centralStoreIds[0];
      if (centralId) {
        notifyChatHqWithdrawal(centralId, {
          product_name: selectedHqDeposit.product_name || 'Product',
          customer_name: selectedHqDeposit.customer_name,
          from_store_name: selectedHqDeposit.from_store_name,
          withdrawn_by_name: user?.displayName || user?.username || 'HQ Staff',
          notes: withdrawNotes || null,
        });
      }

      setShowWithdrawModal(false);
      setSelectedHqDeposit(null);
      await loadAllData();
    } catch {
      toast({ type: 'error', title: t('withdrawError') });
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  // ==========================================
  // Tabs Config
  // ==========================================

  const tabs: { id: TabId; label: string; icon: typeof Clock; count: number; color: string }[] = [
    { id: 'pending', label: t('tabPending'), icon: Clock, count: summary.pending, color: 'yellow' },
    { id: 'received', label: t('tabReceived'), icon: Package, count: summary.received, color: 'green' },
    // Count omitted on history (depends on selected date — fetched lazily).
    { id: 'history', label: t('tabHistory'), icon: FileText, count: 0, color: 'blue' },
    { id: 'withdrawn', label: t('tabWithdrawn'), icon: BoxSelect, count: summary.withdrawn, color: 'gray' },
  ];

  // ==========================================
  // No central store check
  // ==========================================

  if (stores.length > 0 && centralStores.length === 0) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-4">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-lg dark:bg-gray-900">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30">
            <Warehouse className="h-8 w-8 text-orange-600 dark:text-orange-400" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t('noCentralStore')}</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t('noCentralStoreDesc')}
          </p>
        </div>
      </div>
    );
  }

  // ==========================================
  // Render
  // ==========================================

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Compact header — single line on desktop, wraps to two lines on
          mobile. The big gradient banner from the previous design ate
          ~140 px before the user saw any data; this version is ~56 px. */}
      <header className="bg-white px-4 py-2.5 shadow-sm ring-1 ring-gray-100 dark:bg-gray-900 dark:ring-gray-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="rounded-md bg-orange-100 p-1.5 dark:bg-orange-900/30">
              <Warehouse className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold text-gray-900 dark:text-white">
                {t('title')}
              </h1>
              <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                {centralStores.map((s) => s.store_name).join(', ')}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setShowBranchSummary(!showBranchSummary)}
              className="hidden items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 sm:flex dark:text-gray-300 dark:hover:bg-gray-800"
              title={t('branchSummary')}
            >
              <StoreIcon className="h-3.5 w-3.5" />
              {t('branchSummary')}
            </button>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="rounded-md p-1.5 text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-gray-800"
              title="Refresh"
            >
              <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Branch summary popover — opens under the header without
            pushing the page. Hidden on mobile via the button above. */}
        {showBranchSummary && (
          <div className="mx-auto mt-2 max-w-7xl rounded-lg bg-white p-2 text-xs shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700">
            {branchSummaryData.length === 0 ? (
              <p className="py-1 text-center text-gray-400">{t('noBranchData')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {branchSummaryData.map((branch) => (
                  <div
                    key={branch.storeId}
                    className="flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-0.5 ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700"
                  >
                    <span className="font-medium text-gray-700 dark:text-gray-200">
                      {branch.storeName}
                    </span>
                    {branch.pending > 0 && (
                      <span className="rounded-full bg-yellow-100 px-1.5 font-bold text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                        {branch.pending}
                      </span>
                    )}
                    {branch.received > 0 && (
                      <span className="rounded-full bg-green-100 px-1.5 font-bold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        {branch.received}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      {/* Sticky toolbar — tabs, store filter, search, all in one row.
          Replaces the old "summary cards + tab nav + filters" stack
          (saved ~200 px). Tabs carry their own count badge so the
          big summary cards are no longer needed. */}
      <div className="sticky top-0 z-40 bg-white shadow-sm ring-1 ring-gray-100 dark:bg-gray-900 dark:ring-gray-800">
        <div className="mx-auto max-w-7xl px-3 py-2">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <nav className="-mx-1 flex gap-1 overflow-x-auto px-1">
              {tabs.map((tab) => {
                const TabIcon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition',
                      active
                        ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700',
                    )}
                  >
                    <TabIcon className="h-3.5 w-3.5" />
                    {tab.label}
                    {tab.id !== 'history' && tab.count > 0 && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                          active
                            ? 'bg-white/25 text-white'
                            : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
                        )}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="flex flex-1 gap-2 lg:max-w-md lg:ml-auto">
              <select
                value={filterBranch}
                onChange={(e) => setFilterBranch(e.target.value)}
                className="rounded-md bg-white px-2 py-1.5 text-xs ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-300 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700"
              >
                <option value="">{t('allBranches')}</option>
                {branchStores.map((store) => (
                  <option key={store.id} value={store.id}>{store.store_name}</option>
                ))}
              </select>
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="w-full rounded-md bg-white py-1.5 pl-7 pr-2 text-xs ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-300 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-3 py-3 pb-24">
        {loading ? (
          <div className="rounded-lg bg-white p-8 text-center shadow dark:bg-gray-900">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-orange-500" />
            <p className="mt-4 text-gray-500 dark:text-gray-400">{t('loadingData')}</p>
          </div>
        ) : (
          <>
            {/* Tab: Pending */}
            {activeTab === 'pending' && (
              <div className="space-y-3">
                {filteredPending.length === 0 ? (
                  <EmptyState message={t('noPendingItems')} />
                ) : (
                  pendingByBatch.map((batch) => {
                    const isExpanded = expandedBranches.has(batch.group_key);
                    return (
                      <div key={batch.group_key} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700">
                        {/* Batch Header */}
                        <button
                          onClick={() => toggleBranch(batch.group_key)}
                          className="flex w-full items-center justify-between bg-gradient-to-r from-yellow-50 to-amber-50 px-4 py-3 transition hover:from-yellow-100 hover:to-amber-100 dark:from-yellow-900/20 dark:to-amber-900/20 dark:hover:from-yellow-900/30 dark:hover:to-amber-900/30"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-orange-600 dark:text-orange-400">{batch.transfer_code}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">({batch.from_store_name})</span>
                            <span className="rounded-full bg-yellow-500 px-2 py-0.5 text-xs font-bold text-white">
                              {t('itemCount', { count: batch.items.length })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">{formatThaiDateTime(batch.created_at)}</span>
                            {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
                          </div>
                        </button>

                        {/* Batch-level receive bar — partial-receipt aware.
                            Renders one of 3 states:
                              1. Claimed in chat → locked notice
                              2. Collapsed (no expand) → "รับทั้งหมด" shortcut
                              3. Expanded → checkbox-driven partial receive
                            All three live on the same yellow strip so the
                            batch header always has consistent affordance. */}
                        {(() => {
                          const batchClaim = chatClaims.get(batch.transfer_code);
                          if (batchClaim) {
                            return (
                              <div className="border-t border-yellow-100 bg-yellow-50/50 px-4 py-2 dark:border-yellow-900/30 dark:bg-yellow-900/10">
                                <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                                  <Hand className="h-3.5 w-3.5 shrink-0" />
                                  <span>
                                    {(batchClaim.claimedByName || 'พนักงาน')} กำลังดำเนินการในแชท
                                  </span>
                                </div>
                              </div>
                            );
                          }
                          if (!isExpanded) {
                            return (
                              <div className="border-t border-yellow-100 bg-yellow-50/50 px-4 py-2 dark:border-yellow-900/30 dark:bg-yellow-900/10">
                                <button
                                  onClick={() => openBatchConfirmModal(batch)}
                                  className="w-full rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 py-2.5 text-sm font-bold text-white shadow-md transition hover:from-green-600 hover:to-emerald-700"
                                >
                                  <Check className="mr-1 inline h-4 w-4" /> {t('receiveAll', { count: batch.items.length })}
                                </button>
                              </div>
                            );
                          }
                          // Expanded → render the partial-receipt bar at
                          // the bottom (after items list). The bottom bar
                          // lives below; here we just render an info hint.
                          return null;
                        })()}

                        {/* Batch Transfer Cards — compact one-row layout */}
                        {isExpanded && (() => {
                          // Local-to-batch search: filter just this
                          // batch's items by deposit_code / product /
                          // customer. Empty string => show all items.
                          const localQuery = (batchSearch.get(batch.group_key) || '').toLowerCase().trim();
                          const visibleItems = localQuery
                            ? batch.items.filter((it) =>
                                it.deposit_code?.toLowerCase().includes(localQuery) ||
                                it.product_name?.toLowerCase().includes(localQuery) ||
                                it.customer_name?.toLowerCase().includes(localQuery),
                              )
                            : batch.items;
                          return (
                          <div className="space-y-1.5 p-2">
                            {/* Per-batch search box */}
                            <div className="relative">
                              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                              <input
                                type="text"
                                value={batchSearch.get(batch.group_key) || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setBatchSearch((prev) => {
                                    const next = new Map(prev);
                                    if (v) next.set(batch.group_key, v);
                                    else next.delete(batch.group_key);
                                    return next;
                                  });
                                }}
                                placeholder={`ค้นหาในใบโอนนี้ (${batch.items.length} รายการ) — รหัสฝาก / สินค้า / ลูกค้า`}
                                className="w-full rounded-md bg-white py-1.5 pl-7 pr-7 text-xs ring-1 ring-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-400 dark:bg-gray-800 dark:text-gray-200 dark:ring-yellow-900/40"
                              />
                              {batchSearch.get(batch.group_key) && (
                                <button
                                  onClick={() => setBatchSearch((prev) => {
                                    const next = new Map(prev);
                                    next.delete(batch.group_key);
                                    return next;
                                  })}
                                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                                  aria-label="ล้างคำค้นหา"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            {visibleItems.length === 0 ? (
                              <div className="rounded-md bg-gray-50 px-3 py-4 text-center text-xs text-gray-400 dark:bg-gray-800">
                                ไม่พบรายการที่ตรงกับ &quot;{batchSearch.get(batch.group_key)}&quot;
                              </div>
                            ) : null}

                            {visibleItems.map((transfer) => {
                              // Per-item button gate uses the same
                              // batch-level claim — every item in the
                              // batch shares the same chat card.
                              const itemClaim = chatClaims.get(transfer.transfer_code);
                              const itemClaimedInChat = !!itemClaim;
                              const batchSelection = pendingSelection.get(batch.group_key) ?? new Set<string>();
                              const checked = batchSelection.has(transfer.id);
                              const toggleItem = () => {
                                setPendingSelection((prev) => {
                                  const next = new Map(prev);
                                  const set = new Set(next.get(batch.group_key) ?? []);
                                  if (set.has(transfer.id)) set.delete(transfer.id);
                                  else set.add(transfer.id);
                                  if (set.size === 0) next.delete(batch.group_key);
                                  else next.set(batch.group_key, set);
                                  return next;
                                });
                              };
                              return (
                              <div key={transfer.id} className={cn(
                                "flex items-center gap-2 overflow-hidden rounded-xl bg-white px-3 py-2 shadow-sm ring-1 dark:bg-gray-800",
                                checked
                                  ? "ring-emerald-300 dark:ring-emerald-700"
                                  : "ring-gray-200 dark:ring-gray-700"
                              )}>
                                <label className="flex shrink-0 cursor-pointer items-center" title={t('selectThisItem')}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={toggleItem}
                                    className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 dark:border-gray-600"
                                  />
                                </label>

                                {/* Body — single line of metadata; truncate on
                                    overflow so a long product/customer string
                                    doesn't push the action buttons off screen. */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                                    <span className="truncate font-medium text-gray-900 dark:text-white">
                                      {transfer.product_name || transfer.deposit_code || t('unspecified')}
                                    </span>
                                    {transfer.customer_name && (
                                      <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                                        · {transfer.customer_name}
                                      </span>
                                    )}
                                    <span className="ml-auto whitespace-nowrap text-xs font-semibold text-gray-700 dark:text-gray-200">
                                      {transfer.quantity || 1} {t('bottles')}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-400">
                                    {transfer.deposit_code && (
                                      <span className="font-mono">{transfer.deposit_code}</span>
                                    )}
                                    {transfer.requested_by_name && (
                                      <span>โดย {transfer.requested_by_name}</span>
                                    )}
                                  </div>
                                </div>

                                {/* Compact action row — icon-only buttons keep
                                    the card height down; tooltips supply the
                                    label that the old text buttons carried. */}
                                {itemClaimedInChat ? (
                                  <div className="flex shrink-0 items-center gap-1">
                                    {transfer.photo_url && (
                                      <button
                                        onClick={() => setViewingPhoto(transfer.photo_url)}
                                        className="rounded-md bg-blue-50 p-1.5 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400"
                                        title={t('transferPhotoFromBranch')}
                                      >
                                        <ImageIcon className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                    {transfer.deposit_photo_url && (
                                      <button
                                        onClick={() => setViewingPhoto(transfer.deposit_photo_url)}
                                        className="rounded-md bg-amber-50 p-1.5 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400"
                                        title={t('depositPhotoFromBranch')}
                                      >
                                        <ImageIcon className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => { setSelectedTransfer(transfer); setShowDetailModal(true); }}
                                      className="rounded-md bg-blue-100 p-1.5 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400"
                                      title={t('viewDetail')}
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                    </button>
                                    <span
                                      className="flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[10px] text-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
                                      title={`${itemClaim?.claimedByName || 'พนักงาน'} กำลังดำเนินการในแชท`}
                                    >
                                      <Hand className="h-3 w-3" />
                                      <span className="hidden sm:inline truncate max-w-[80px]">
                                        {itemClaim?.claimedByName || 'พนักงาน'}
                                      </span>
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex shrink-0 items-center gap-1">
                                    {transfer.photo_url && (
                                      <button
                                        onClick={() => setViewingPhoto(transfer.photo_url)}
                                        className="rounded-md bg-blue-50 p-1.5 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400"
                                        title={t('transferPhotoFromBranch')}
                                      >
                                        <ImageIcon className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                    {transfer.deposit_photo_url && (
                                      <button
                                        onClick={() => setViewingPhoto(transfer.deposit_photo_url)}
                                        className="rounded-md bg-amber-50 p-1.5 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400"
                                        title={t('depositPhotoFromBranch')}
                                      >
                                        <ImageIcon className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => { setSelectedTransfer(transfer); setShowDetailModal(true); }}
                                      className="rounded-md bg-blue-100 p-1.5 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400"
                                      title={t('viewDetail')}
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={() => openConfirmModal(transfer)}
                                      className="rounded-md bg-gradient-to-r from-green-500 to-emerald-600 px-2 py-1 text-xs font-bold text-white shadow-sm hover:from-green-600 hover:to-emerald-700"
                                      title={t('receiveItem')}
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={() => openRejectModal(transfer)}
                                      className="rounded-md bg-red-100 p-1.5 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                                      title="ปฏิเสธ"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                              );
                            })}

                            {/* Partial-receipt action bar — only when
                                expanded and not chat-claimed. Picks up
                                pendingSelection and either receives the
                                ticked subset or the whole batch. */}
                            {!chatClaims.get(batch.transfer_code) && (() => {
                              const sel = pendingSelection.get(batch.group_key) ?? new Set<string>();
                              const total = batch.items.length;
                              const allSelected = sel.size === total;
                              const someSelected = sel.size > 0 && !allSelected;
                              const setAll = (on: boolean) => {
                                setPendingSelection((prev) => {
                                  const next = new Map(prev);
                                  if (on) next.set(batch.group_key, new Set(batch.items.map((i) => i.id)));
                                  else next.delete(batch.group_key);
                                  return next;
                                });
                              };
                              return (
                                <div className="sticky bottom-2 mt-2 rounded-xl bg-white/95 p-3 shadow-md ring-1 ring-yellow-200 backdrop-blur dark:bg-gray-900/95 dark:ring-yellow-900/50">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                      <input
                                        type="checkbox"
                                        checked={allSelected}
                                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                                        onChange={(e) => setAll(e.target.checked)}
                                        className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 dark:border-gray-600"
                                      />
                                      <span>
                                        {sel.size > 0
                                          ? t('selectedOfTotal', { selected: sel.size, total })
                                          : t('selectAllBatch')}
                                      </span>
                                    </label>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => openBatchConfirmModal(batch)}
                                        className="rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-md transition hover:from-green-600 hover:to-emerald-700"
                                      >
                                        <Check className="mr-1 inline h-4 w-4" />
                                        {sel.size > 0 && sel.size < total
                                          ? t('receiveSelectedCount', { count: sel.size })
                                          : t('receiveAll', { count: total })}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                          );
                        })()}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Tab: Received */}
            {activeTab === 'received' && (
              <div className="space-y-3 pb-20">

                {/* Toolbar: select-all + view mode toggle */}
                {filteredReceived.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 shadow-sm dark:bg-gray-900">
                    {canWithdraw ? (
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={allFilteredReceivedSelected}
                          onChange={toggleSelectAllReceived}
                          className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 dark:border-gray-600"
                        />
                        <span>
                          {selectedReceivedIds.size > 0
                            ? t('selectedCount', { count: selectedReceivedIds.size })
                            : t('selectAll')}
                        </span>
                      </label>
                    ) : (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {t('itemCount', { count: filteredReceived.length })}
                      </span>
                    )}

                    <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
                      <button
                        onClick={() => setReceivedViewMode('card')}
                        className={cn(
                          'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition',
                          receivedViewMode === 'card'
                            ? 'bg-white text-orange-600 shadow-sm dark:bg-gray-700 dark:text-orange-400'
                            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400',
                        )}
                        title={t('viewModeCard')}
                      >
                        <LayoutGrid className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{t('viewModeCard')}</span>
                      </button>
                      <button
                        onClick={() => setReceivedViewMode('table')}
                        className={cn(
                          'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition',
                          receivedViewMode === 'table'
                            ? 'bg-white text-orange-600 shadow-sm dark:bg-gray-700 dark:text-orange-400'
                            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400',
                        )}
                        title={t('viewModeTable')}
                      >
                        <List className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{t('viewModeTable')}</span>
                      </button>
                    </div>
                  </div>
                )}

                {filteredReceived.length === 0 ? (
                  <EmptyState message={t('noReceivedItems')} />
                ) : receivedViewMode === 'card' ? (
                  // Compact one-row card — same density as the pending tab.
                  // Quantity, branch, deposit code and received timestamp
                  // share a single line under the product name; actions are
                  // icon-only with tooltips.
                  <div className="space-y-1.5">
                    {filteredReceived.map((item) => {
                      const isSelected = selectedReceivedIds.has(item.id);
                      return (
                        <div
                          key={item.id}
                          className={cn(
                            'flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-sm ring-1 transition dark:bg-gray-900',
                            isSelected
                              ? 'ring-orange-300 dark:ring-orange-700'
                              : 'ring-gray-200 dark:ring-gray-700',
                          )}
                        >
                          {canWithdraw && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleReceivedSelection(item.id)}
                              className="h-4 w-4 shrink-0 rounded border-gray-300 text-orange-600 focus:ring-orange-500 dark:border-gray-600"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                              <span className="truncate font-medium text-gray-900 dark:text-white">
                                {item.product_name || t('unspecified')}
                              </span>
                              {item.customer_name && (
                                <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                                  · {item.customer_name}
                                </span>
                              )}
                              <span className="ml-auto whitespace-nowrap text-xs font-semibold text-green-700 dark:text-green-400">
                                {item.quantity || 1} {t('bottles')}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-400">
                              <span>{item.from_store_name}</span>
                              {item.deposit_code && <span className="font-mono">{item.deposit_code}</span>}
                              <span className="ml-auto">{formatThaiDateTime(item.received_at)}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {item.received_photo_url && (
                              <button
                                onClick={() => setViewingPhoto(item.received_photo_url)}
                                className="rounded-md bg-gray-100 p-1.5 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
                                title="ดูรูปยืนยัน"
                              >
                                <ImageIcon className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canWithdraw && (
                              <button
                                onClick={() => openWithdrawModal(item)}
                                className="rounded-md bg-gradient-to-r from-orange-500 to-amber-600 px-2 py-1 text-xs font-bold text-white shadow-sm hover:from-orange-600 hover:to-amber-700"
                                title={t('withdrawItem')}
                              >
                                <BoxSelect className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl bg-white shadow-sm dark:bg-gray-900">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-400">
                            {canWithdraw && (
                              <th className="px-3 py-2.5">
                                <input
                                  type="checkbox"
                                  checked={allFilteredReceivedSelected}
                                  onChange={toggleSelectAllReceived}
                                  className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 dark:border-gray-600"
                                />
                              </th>
                            )}
                            <th className="px-3 py-2.5">{t('colProduct')}</th>
                            <th className="px-3 py-2.5">{t('colCustomer')}</th>
                            <th className="hidden px-3 py-2.5 md:table-cell">{t('colBranch')}</th>
                            <th className="px-3 py-2.5 text-right">{t('colQty')}</th>
                            <th className="hidden px-3 py-2.5 md:table-cell">{t('colReceivedAt')}</th>
                            <th className="px-3 py-2.5 text-right">{t('colActions')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          {filteredReceived.map((item) => {
                            const isSelected = selectedReceivedIds.has(item.id);
                            return (
                              <tr
                                key={item.id}
                                className={cn(
                                  'transition-colors',
                                  isSelected
                                    ? 'bg-orange-50 dark:bg-orange-900/20'
                                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
                                )}
                              >
                                {canWithdraw && (
                                  <td className="px-3 py-2.5">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleReceivedSelection(item.id)}
                                      className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 dark:border-gray-600"
                                    />
                                  </td>
                                )}
                                <td className="px-3 py-2.5">
                                  <p className="font-medium text-gray-900 dark:text-white">{item.product_name || t('unspecified')}</p>
                                  {item.deposit_code && (
                                    <p className="font-mono text-[10px] text-gray-400">{item.deposit_code}</p>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300">
                                  {item.customer_name || '-'}
                                </td>
                                <td className="hidden px-3 py-2.5 text-gray-600 dark:text-gray-400 md:table-cell">
                                  {item.from_store_name}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold text-green-600">
                                  {item.quantity || 1} <span className="text-xs font-normal text-gray-400">{t('bottles')}</span>
                                </td>
                                <td className="hidden px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400 md:table-cell">
                                  {formatThaiDateTime(item.received_at)}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  <div className="inline-flex items-center gap-1">
                                    {item.received_photo_url && (
                                      <button
                                        onClick={() => setViewingPhoto(item.received_photo_url)}
                                        className="rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                                        title={t('viewAttachedPhoto')}
                                      >
                                        <ImageIcon className="h-4 w-4" />
                                      </button>
                                    )}
                                    {canWithdraw && (
                                      <button
                                        onClick={() => openWithdrawModal(item)}
                                        className="rounded-md bg-orange-100 px-2 py-1 text-xs font-medium text-orange-700 transition hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400"
                                      >
                                        <BoxSelect className="mr-0.5 inline h-3.5 w-3.5" />
                                        {t('withdrawItem')}
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Sticky bulk action bar when items are selected.
                    Sits above the dashboard's mobile bottom nav (~64 px,
                    z-50) instead of behind it — the previous bottom-0 +
                    z-40 combo got covered. Adds a safe-area inset for
                    iOS so it clears the home indicator too. */}
                {canWithdraw && selectedReceivedIds.size > 0 && (
                  <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+64px)] z-50 border-t border-orange-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm dark:border-orange-900/50 dark:bg-gray-900/95">
                    <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
                      <div className="text-sm text-gray-600 dark:text-gray-300">
                        <span className="font-bold text-orange-600 dark:text-orange-400">
                          {selectedReceivedIds.size}
                        </span>{' '}
                        {t('itemsSelected')}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={clearReceivedSelection}
                          className="rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
                        >
                          {t('clearSelection')}
                        </button>
                        <button
                          onClick={openBulkWithdrawModal}
                          className="rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 px-4 py-2 text-sm font-bold text-white shadow transition hover:from-orange-600 hover:to-amber-700"
                        >
                          <BoxSelect className="mr-1 inline h-4 w-4" />
                          {t('withdrawSelected', { count: selectedReceivedIds.size })}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab: History (รายงานรับเข้ารายวัน) */}
            {activeTab === 'history' && (
              <ReceiveHistoryView
                date={historyDate}
                setDate={setHistoryDate}
                items={historyData}
                loading={historyLoading}
                hqName={centralStores[0]?.store_name || 'HQ'}
                searchQuery={searchQuery}
                downloading={downloadingPdf}
                onDownload={async () => {
                  setDownloadingPdf(true);
                  try {
                    // Lazy-load the PDF module so the ~600 KB react-pdf
                    // bundle doesn't ship on tabs that never use it.
                    const mod = await import('./_components/receive-report-pdf');
                    const data = buildReportData(
                      historyDate,
                      historyData,
                      centralStores[0]?.store_name || 'HQ',
                    );
                    const blob = await mod.buildReceiveReportPdf(data);
                    mod.downloadBlob(
                      blob,
                      `รายงานรับเข้า-${historyDate}.pdf`,
                    );
                  } catch (err) {
                    console.error('PDF download error:', err);
                    toast({ type: 'error', title: 'สร้าง PDF ล้มเหลว' });
                  } finally {
                    setDownloadingPdf(false);
                  }
                }}
              />
            )}

            {/* Tab: Withdrawn */}
            {activeTab === 'withdrawn' && (
              <div className="space-y-3">
                {/* Date filter */}
                <div className="flex gap-2 rounded-lg bg-white p-3 shadow-sm dark:bg-gray-900">
                  {(['today', 'week', 'all'] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setWithdrawnDateFilter(filter)}
                      className={cn(
                        'flex-1 rounded-lg py-2 text-sm font-medium transition',
                        withdrawnDateFilter === filter
                          ? 'bg-gray-700 text-white dark:bg-gray-600'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
                      )}
                    >
                      {filter === 'today' ? t('filterToday') : filter === 'week' ? t('filter7Days') : t('filterAllTime')}
                    </button>
                  ))}
                </div>

                {filteredWithdrawn.length === 0 ? (
                  <EmptyState message={t('noWithdrawnItems')} />
                ) : (
                  filteredWithdrawn.map((item) => (
                    <div key={item.id} className="rounded-xl border-l-4 border-gray-400 bg-white p-4 shadow-sm dark:bg-gray-900">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-gray-800 dark:text-gray-100">{item.product_name || t('unspecified')}</p>
                          <p className="text-sm text-gray-500 dark:text-gray-400">{item.customer_name || '-'}</p>
                          <p className="mt-1 text-xs text-gray-400">{t('fromBranch', { name: item.from_store_name })}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-lg font-bold text-gray-600">{item.quantity || 1}</span>
                          <span className="ml-1 text-sm text-gray-400">{t('bottles')}</span>
                          {item.withdrawn_at && (
                            <p className="mt-1 text-xs text-gray-400">
                              {t('withdrawnAt', { date: formatThaiDateTime(item.withdrawn_at) })}
                            </p>
                          )}
                          {item.withdrawn_by_name && (
                            <p className="text-xs text-gray-400">{t('withdrawnBy', { name: item.withdrawn_by_name })}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

          </>
        )}
      </main>

      {/* ==========================================
          MODALS
          ========================================== */}

      {/* Transfer Detail Modal */}
      {showDetailModal && selectedTransfer && (
        <Modal onClose={() => setShowDetailModal(false)}>
          <div className="rounded-t-2xl bg-gradient-to-r from-blue-500 to-indigo-600 p-5 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-white/20 p-2">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">{t('transferDetailTitle')}</h2>
                  <p className="text-sm text-blue-100">{selectedTransfer.transfer_code}</p>
                </div>
              </div>
              <button onClick={() => setShowDetailModal(false)} className="rounded-xl p-2 transition hover:bg-white/20">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="p-5">
            <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-800">
              <div>
                <span className="text-gray-500">{t('originBranch')}</span>
                <p className="font-medium dark:text-gray-200">{selectedTransfer.from_store_name}</p>
              </div>
              <div>
                <span className="text-gray-500">{t('transferDate')}</span>
                <p className="font-medium dark:text-gray-200">{formatThaiDateTime(selectedTransfer.created_at)}</p>
              </div>
              <div>
                <span className="text-gray-500">{t('submitter')}</span>
                <p className="font-medium dark:text-gray-200">{selectedTransfer.requested_by_name || '-'}</p>
              </div>
              <div>
                <span className="text-gray-500">{t('statusLabel')}</span>
                <p className="font-medium text-yellow-600">{t('statusPending')}</p>
              </div>
              {selectedTransfer.product_name && (
                <div>
                  <span className="text-gray-500">{t('productName')}</span>
                  <p className="font-medium dark:text-gray-200">{selectedTransfer.product_name}</p>
                </div>
              )}
              {selectedTransfer.customer_name && (
                <div>
                  <span className="text-gray-500">{t('customerName')}</span>
                  <p className="font-medium dark:text-gray-200">{selectedTransfer.customer_name}</p>
                </div>
              )}
              {selectedTransfer.quantity && (
                <div>
                  <span className="text-gray-500">{t('quantityLabel')}</span>
                  <p className="font-medium dark:text-gray-200">{selectedTransfer.quantity} {t('bottles')}</p>
                </div>
              )}
            </div>
            {selectedTransfer.notes && (
              <div className="mb-4 rounded-xl bg-gray-50 p-3 dark:bg-gray-800">
                <span className="text-sm text-gray-500">{t('notesLabel')}</span>
                <p className="text-sm dark:text-gray-200">{selectedTransfer.notes}</p>
              </div>
            )}

            {/* Per-bottle remaining % from deposit_bottles */}
            <div className="mb-4 rounded-xl bg-emerald-50 p-3 dark:bg-emerald-900/20">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  ปริมาณคงเหลือต่อขวด
                </span>
                {detailExtras && detailExtras.bottles.length > 0 && (
                  <span className="text-xs text-emerald-700 dark:text-emerald-400">
                    {detailExtras.bottles.length} ขวด
                  </span>
                )}
              </div>
              {detailLoading ? (
                <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                  <Loader2 className="h-3 w-3 animate-spin" /> กำลังโหลด...
                </div>
              ) : detailExtras && detailExtras.bottles.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {detailExtras.bottles.map((b) => (
                    <span
                      key={b.bottle_no}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xs font-bold tabular-nums',
                        b.remaining_percent >= 90
                          ? 'bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100'
                          : b.remaining_percent >= 50
                            ? 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100'
                            : 'bg-rose-200 text-rose-900 dark:bg-rose-800 dark:text-rose-100',
                      )}
                      title={`ขวดที่ ${b.bottle_no}`}
                    >
                      ขวด {b.bottle_no}: {b.remaining_percent}%
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  ไม่มีข้อมูลปริมาณคงเหลือ (ฝากแบบเดิมก่อนระบบติดตามต่อขวด)
                </p>
              )}
            </div>

            {/* Photo buttons — original deposit (branch) + transfer (HQ) */}
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {detailExtras?.deposit_photo_url ? (
                <button
                  onClick={() => setViewingPhoto(detailExtras.deposit_photo_url)}
                  className="rounded-xl bg-amber-100 py-3 text-sm font-medium text-amber-700 transition hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400"
                >
                  <ImageIcon className="mr-2 inline h-4 w-4" />
                  รูปฝากเหล้าจากสาขา
                </button>
              ) : !detailLoading ? (
                <div className="rounded-xl bg-gray-100 py-3 text-center text-xs text-gray-400 dark:bg-gray-800">
                  ไม่มีรูปฝากเดิม
                </div>
              ) : null}
              {selectedTransfer.photo_url && (
                <button
                  onClick={() => setViewingPhoto(selectedTransfer.photo_url)}
                  className="rounded-xl bg-blue-100 py-3 text-sm font-medium text-blue-700 transition hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400"
                >
                  <ImageIcon className="mr-2 inline h-4 w-4" /> {t('viewAttachedPhoto')}
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDetailModal(false)}
                className="flex-1 rounded-xl bg-gray-200 py-3 font-semibold text-gray-700 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
              >
                {t('close')}
              </button>
              <button
                onClick={() => { setShowDetailModal(false); openRejectModal(selectedTransfer); }}
                className="rounded-xl bg-red-100 px-4 py-3 font-semibold text-red-600 transition hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
              >
                <X className="mr-1 inline h-4 w-4" /> {t('reject')}
              </button>
              <button
                onClick={() => { setShowDetailModal(false); openConfirmModal(selectedTransfer); }}
                className="flex-1 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 py-3 font-semibold text-white shadow-lg transition hover:from-green-600 hover:to-emerald-700"
              >
                <Check className="mr-1 inline h-4 w-4" /> {t('receiveItem')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm Transfer Modal */}
      {showConfirmModal && selectedTransfer && (
        <Modal onClose={() => setShowConfirmModal(false)}>
          {confirmStep === 1 ? (
            <>
              <div className="rounded-t-2xl bg-gradient-to-r from-green-500 to-emerald-600 p-5 text-white">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-white/20 p-2">
                    <Check className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{t('receiveToWarehouse')}</h2>
                    <p className="text-sm text-green-100">{selectedTransfer.transfer_code}</p>
                  </div>
                </div>
              </div>
              <div className="p-5">
                <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-800">
                  <div>
                    <span className="text-gray-500">{t('branchLabel')}</span>
                    <p className="font-medium dark:text-gray-200">{selectedTransfer.from_store_name}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">{t('productName')}</span>
                    <p className="font-medium dark:text-gray-200">{selectedTransfer.product_name || '-'}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">{t('quantityLabel')}</span>
                    <p className="font-medium dark:text-gray-200">{selectedTransfer.quantity || 1} {t('bottles')}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">{t('customerName')}</span>
                    <p className="font-medium dark:text-gray-200">{selectedTransfer.customer_name || '-'}</p>
                  </div>
                </div>

                {selectedTransfer.photo_url && (
                  <div className="mb-4">
                    <button
                      onClick={() => setViewingPhoto(selectedTransfer.photo_url)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 py-3 font-semibold text-white shadow-lg transition hover:from-blue-600 hover:to-indigo-700"
                    >
                      <ImageIcon className="h-4 w-4" /> {t('viewBranchPhoto')}
                    </button>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    className="flex-1 rounded-xl bg-gray-200 py-3 font-semibold text-gray-700 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    onClick={() => setConfirmStep(2)}
                    className="flex-1 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 py-3 font-semibold text-white shadow-lg transition hover:from-green-600 hover:to-emerald-700"
                  >
                    {t('nextStep')}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-t-2xl bg-gradient-to-r from-blue-500 to-indigo-600 p-5 text-white">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-white/20 p-2">
                    <Camera className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{t('takeConfirmPhoto')}</h2>
                    <p className="text-sm text-blue-100">{t('takeConfirmPhotoDesc')}</p>
                  </div>
                </div>
              </div>
              <div className="p-5">
                <PhotoUpload
                  value={confirmPhotoUrl}
                  onChange={setConfirmPhotoUrl}
                  folder="hq-received"
                  label={t('attachConfirmPhoto')}
                  required
                  placeholder={t('photoReceivedProduct')}
                />

                <div className="mt-4">
                  <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">{t('receiverLabel')}</label>
                  <input
                    type="text"
                    readOnly
                    value={user?.displayName || user?.username || ''}
                    className="w-full rounded-xl border-2 border-gray-200 bg-gray-100 px-4 py-3 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  />
                </div>

                <div className="mt-4">
                  <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">{t('notesOptional')}</label>
                  <textarea
                    value={confirmNotes}
                    onChange={(e) => setConfirmNotes(e.target.value)}
                    rows={2}
                    placeholder={t('notesPlaceholder')}
                    className="w-full resize-none rounded-xl border-2 border-gray-200 px-4 py-3 transition focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  />
                </div>

                <div className="mt-4 flex gap-3">
                  <button
                    onClick={() => setConfirmStep(1)}
                    className="flex-1 rounded-xl bg-gray-200 py-3 font-semibold text-gray-700 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
                  >
                    {t('goBack')}
                  </button>
                  <button
                    onClick={submitConfirmTransfer}
                    disabled={!confirmPhotoUrl || confirmSubmitting}
                    className="flex-1 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 py-3 font-semibold text-white shadow-lg transition hover:from-green-600 hover:to-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {confirmSubmitting ? (
                      <><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> {t('saving')}</>
                    ) : (
                      <><Check className="mr-1 inline h-4 w-4" /> {t('confirmReceive')}</>
                    )}
                  </button>
                </div>
                {!confirmPhotoUrl && (
                  <p className="mt-2 text-center text-sm text-red-500">
                    <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                    {t('photoRequired')}
                  </p>
                )}
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Withdraw Modal */}
      {showWithdrawModal && selectedHqDeposit && (
        <Modal onClose={() => setShowWithdrawModal(false)}>
          <div className="rounded-t-2xl bg-gradient-to-r from-orange-500 to-amber-600 p-5 text-white">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white/20 p-2">
                <BoxSelect className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{t('withdrawTitle')}</h2>
                <p className="text-sm text-orange-100">{selectedHqDeposit.product_name || ''}</p>
              </div>
            </div>
          </div>
          <div className="p-5">
            <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-800">
              <div>
                <span className="text-gray-500">{t('productName')}</span>
                <p className="font-medium dark:text-gray-200">{selectedHqDeposit.product_name || '-'}</p>
              </div>
              <div>
                <span className="text-gray-500">{t('quantityLabel')}</span>
                <p className="font-medium dark:text-gray-200">{selectedHqDeposit.quantity || 1} {t('bottles')}</p>
              </div>
              <div>
                <span className="text-gray-500">{t('customerName')}</span>
                <p className="font-medium dark:text-gray-200">{selectedHqDeposit.customer_name || '-'}</p>
              </div>
              <div>
                <span className="text-gray-500">{t('fromBranchField')}</span>
                <p className="font-medium dark:text-gray-200">{selectedHqDeposit.from_store_name}</p>
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">{t('dispenserLabel')}</label>
              <input
                type="text"
                readOnly
                value={user?.displayName || user?.username || ''}
                className="w-full rounded-xl border-2 border-gray-200 bg-gray-100 px-4 py-3 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">{t('notesOptional')}</label>
              <textarea
                value={withdrawNotes}
                onChange={(e) => setWithdrawNotes(e.target.value)}
                rows={2}
                placeholder={t('notesPlaceholder')}
                className="w-full resize-none rounded-xl border-2 border-gray-200 px-4 py-3 transition focus:border-orange-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowWithdrawModal(false)}
                className="flex-1 rounded-xl bg-gray-200 py-3 font-semibold text-gray-700 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
              >
                {t('cancel')}
              </button>
              <button
                onClick={submitWithdraw}
                disabled={withdrawSubmitting}
                className="flex-1 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 py-3 font-semibold text-white shadow-lg transition hover:from-orange-600 hover:to-amber-700 disabled:opacity-50"
              >
                {withdrawSubmitting ? (
                  <><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> {t('saving')}</>
                ) : (
                  <><Check className="mr-1 inline h-4 w-4" /> {t('confirmWithdraw')}</>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Bulk Withdraw Modal */}
      {showBulkWithdrawModal && selectedReceivedItems.length > 0 && (
        <Modal onClose={() => setShowBulkWithdrawModal(false)}>
          <div className="rounded-t-2xl bg-gradient-to-r from-orange-500 to-amber-600 p-5 text-white">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white/20 p-2">
                <BoxSelect className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{t('bulkWithdrawTitle')}</h2>
                <p className="text-sm text-orange-100">
                  {t('bulkWithdrawSubtitle', { count: selectedReceivedItems.length })}
                </p>
              </div>
            </div>
          </div>
          <div className="p-5">
            <div className="mb-4 max-h-60 space-y-2 overflow-y-auto rounded-xl bg-gray-50 p-3 dark:bg-gray-800">
              {selectedReceivedItems.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg bg-white px-3 py-2 ring-1 ring-gray-100 dark:bg-gray-900 dark:ring-gray-700"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                      {idx + 1}. {item.product_name || t('unspecified')}
                    </p>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {item.customer_name || '-'} &bull; {item.from_store_name}
                    </p>
                  </div>
                  <span className="ml-2 shrink-0 text-sm font-bold text-gray-700 dark:text-gray-200">
                    {item.quantity || 1} {t('bottles')}
                  </span>
                </div>
              ))}
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('dispenserLabel')}
              </label>
              <input
                type="text"
                readOnly
                value={user?.displayName || user?.username || ''}
                className="w-full rounded-xl border-2 border-gray-200 bg-gray-100 px-4 py-3 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('notesOptional')}
              </label>
              <textarea
                value={bulkWithdrawNotes}
                onChange={(e) => setBulkWithdrawNotes(e.target.value)}
                rows={2}
                placeholder={t('notesPlaceholder')}
                className="w-full resize-none rounded-xl border-2 border-gray-200 px-4 py-3 transition focus:border-orange-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowBulkWithdrawModal(false)}
                className="flex-1 rounded-xl bg-gray-200 py-3 font-semibold text-gray-700 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
              >
                {t('cancel')}
              </button>
              <button
                onClick={submitBulkWithdraw}
                disabled={bulkWithdrawSubmitting}
                className="flex-1 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 py-3 font-semibold text-white shadow-lg transition hover:from-orange-600 hover:to-amber-700 disabled:opacity-50"
              >
                {bulkWithdrawSubmitting ? (
                  <><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> {t('saving')}</>
                ) : (
                  <><Check className="mr-1 inline h-4 w-4" /> {t('confirmBulkWithdraw', { count: selectedReceivedItems.length })}</>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Modal */}
      {showRejectModal && rejectingTransfer && (
        <Modal onClose={() => setShowRejectModal(false)}>
          <div className="rounded-t-2xl bg-gradient-to-r from-red-500 to-rose-600 p-5 text-white">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white/20 p-2">
                <X className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{t('rejectTransferTitle')}</h2>
                <p className="text-sm text-red-100">{rejectingTransfer.product_name || ''}</p>
              </div>
            </div>
          </div>
          <div className="p-5">
            <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-800">
              <div>
                <span className="text-gray-500">{t('branchLabel')}</span>
                <p className="font-medium dark:text-gray-200">{rejectingTransfer.from_store_name}</p>
              </div>
              <div>
                <span className="text-gray-500">{t('productName')}</span>
                <p className="font-medium dark:text-gray-200">{rejectingTransfer.product_name || '-'}</p>
              </div>
              <div>
                <span className="text-gray-500">{t('quantityLabel')}</span>
                <p className="font-medium dark:text-gray-200">{rejectingTransfer.quantity || 1} {t('bottles')}</p>
              </div>
              <div>
                <span className="text-gray-500">{t('customerName')}</span>
                <p className="font-medium dark:text-gray-200">{rejectingTransfer.customer_name || '-'}</p>
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('rejectReasonLabel')} <span className="text-red-500">*</span>
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder={t('rejectReasonPlaceholder')}
                className="w-full resize-none rounded-xl border-2 border-gray-200 px-4 py-3 transition focus:border-red-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowRejectModal(false); setRejectingTransfer(null); }}
                className="flex-1 rounded-xl bg-gray-200 py-3 font-semibold text-gray-700 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
              >
                {t('cancel')}
              </button>
              <button
                onClick={submitRejectTransfer}
                disabled={!rejectReason.trim() || rejectSubmitting}
                className="flex-1 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 py-3 font-semibold text-white shadow-lg transition hover:from-red-600 hover:to-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rejectSubmitting ? (
                  <><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> {t('saving')}</>
                ) : (
                  <><X className="mr-1 inline h-4 w-4" /> {t('confirmReject')}</>
                )}
              </button>
            </div>
            {!rejectReason.trim() && (
              <p className="mt-2 text-center text-sm text-red-500">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                {t('rejectReasonRequiredMsg')}
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* Batch Confirm Modal (Receive All) */}
      {showBatchConfirmModal && batchConfirmGroup && (
        <Modal onClose={() => setShowBatchConfirmModal(false)}>
          {batchConfirmStep === 1 ? (
            <>
              <div className="rounded-t-2xl bg-gradient-to-r from-green-500 to-emerald-600 p-5 text-white">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-white/20 p-2">
                    <Check className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{t('receiveAllTitle')}</h2>
                    <p className="text-sm text-green-100">{batchConfirmGroup.transfer_code} &bull; {t('itemCount', { count: batchConfirmGroup.items.length })}</p>
                  </div>
                </div>
              </div>
              <div className="p-5">
                <div className="mb-3 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-800">
                  <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">{t('fromBranchLabel', { name: batchConfirmGroup.from_store_name })}</p>
                  <p className="text-xs text-gray-400">{t('sentAtLabel', { date: formatThaiDateTime(batchConfirmGroup.created_at) })}</p>
                </div>

                <div className="mb-4 max-h-60 space-y-2 overflow-y-auto">
                  {batchConfirmGroup.items.map((transfer, idx) => (
                    <div key={transfer.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 ring-1 ring-gray-100 dark:bg-gray-800 dark:ring-gray-700">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{idx + 1}. {transfer.product_name || t('unspecified')}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {transfer.customer_name || '-'}
                          {transfer.deposit_code && <span className="ml-1 font-mono text-gray-400">{transfer.deposit_code}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{transfer.quantity || 1} {t('bottles')}</span>
                        {transfer.photo_url && (
                          <button
                            onClick={() => setViewingPhoto(transfer.photo_url)}
                            className="rounded-md bg-blue-50 p-1 text-blue-600 transition hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400"
                          >
                            <ImageIcon className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowBatchConfirmModal(false)}
                    className="flex-1 rounded-xl bg-gray-200 py-3 font-semibold text-gray-700 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    onClick={() => setBatchConfirmStep(2)}
                    className="flex-1 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 py-3 font-semibold text-white shadow-lg transition hover:from-green-600 hover:to-emerald-700"
                  >
                    {t('nextStep')}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-t-2xl bg-gradient-to-r from-blue-500 to-indigo-600 p-5 text-white">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-white/20 p-2">
                    <Camera className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{t('takeConfirmPhoto')}</h2>
                    <p className="text-sm text-blue-100">{t('onePhotoForAll', { code: batchConfirmGroup.transfer_code })}</p>
                  </div>
                </div>
              </div>
              <div className="p-5">
                <PhotoUpload
                  value={batchConfirmPhotoUrl}
                  onChange={setBatchConfirmPhotoUrl}
                  folder="hq-received"
                  label={t('attachConfirmPhoto')}
                  required
                  placeholder={t('photoReceivedProduct')}
                />

                <div className="mt-4">
                  <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">{t('receiverLabel')}</label>
                  <input
                    type="text"
                    readOnly
                    value={user?.displayName || user?.username || ''}
                    className="w-full rounded-xl border-2 border-gray-200 bg-gray-100 px-4 py-3 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  />
                </div>

                <div className="mt-4">
                  <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">{t('notesOptional')}</label>
                  <textarea
                    value={batchConfirmNotes}
                    onChange={(e) => setBatchConfirmNotes(e.target.value)}
                    rows={2}
                    placeholder={t('notesPlaceholder')}
                    className="w-full resize-none rounded-xl border-2 border-gray-200 px-4 py-3 transition focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  />
                </div>

                <div className="mt-4 flex gap-3">
                  <button
                    onClick={() => setBatchConfirmStep(1)}
                    className="flex-1 rounded-xl bg-gray-200 py-3 font-semibold text-gray-700 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
                  >
                    {t('goBack')}
                  </button>
                  <button
                    onClick={submitBatchConfirmTransfer}
                    disabled={!batchConfirmPhotoUrl || batchConfirmSubmitting}
                    className="flex-1 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 py-3 font-semibold text-white shadow-lg transition hover:from-green-600 hover:to-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {batchConfirmSubmitting ? (
                      <><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> {t('saving')}</>
                    ) : (
                      <><Check className="mr-1 inline h-4 w-4" /> {t('confirmReceiveAll', { count: batchConfirmGroup.items.length })}</>
                    )}
                  </button>
                </div>
                {!batchConfirmPhotoUrl && (
                  <p className="mt-2 text-center text-sm text-red-500">
                    <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                    {t('photoRequired')}
                  </p>
                )}
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Photo Viewer Modal */}
      {viewingPhoto && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setViewingPhoto(null)}
        >
          <div className="relative max-h-full max-w-full">
            <button
              onClick={() => setViewingPhoto(null)}
              className="absolute -top-10 right-0 text-white/80 transition hover:text-white"
            >
              <X className="h-6 w-6" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={viewingPhoto}
              alt="Photo"
              className="max-h-[80vh] max-w-full rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// Sub Components
// ==========================================

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-white p-8 text-center shadow dark:bg-gray-900">
      <Package className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
      <p className="mt-4 text-gray-500 dark:text-gray-400">{message}</p>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
