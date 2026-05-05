'use client';

/**
 * Owner Review — daily post-count workflow for owners + managers.
 *
 * Mirrors the manual "Upper House_INVENTORY" Excel sheet the owner used to
 * keep by hand. For one (store, date) shows every comparison row alongside
 * the recount, conclusion, responsible staff, attached penalty, remark and
 * HR-escalation flag — all editable inline. Pulls quota counts so the
 * owner can see who's close to the SOP's 12/month limit and ping the
 * store chat directly when someone crosses 7.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import {
  Button,
  Input,
  Badge,
  Card,
  CardHeader,
  CardContent,
  EmptyState,
  Modal,
  ModalFooter,
  Select,
  Textarea,
  toast,
} from '@/components/ui';
import { sendChatBotMessage } from '@/lib/chat/bot-client';
import { formatThaiDate, formatSignedQty, formatQty, formatNumber } from '@/lib/utils/format';
import { businessDateBangkok } from '@/lib/utils/date';
import type { Comparison, Penalty, PenaltyCode } from '@/types/database';
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  Loader2,
  Shield,
  Inbox,
  AlertTriangle,
  CheckCircle2,
  Send,
  Plus,
  Calendar,
  Megaphone,
  RotateCcw,
  Eye,
  EyeOff,
} from 'lucide-react';

// SOP target: same role set already gated for /stock/tracking. Manager
// runs this every morning; owner + accountant + hq look in periodically.
const REVIEW_ROLES = ['owner', 'accountant', 'manager', 'hq'];

const QUOTA_WARN = 7;   // SOP: 7+ violations triggers a warning slip
const QUOTA_MAX = 12;   // SOP: hard ceiling per month per store

interface StaffOption {
  id: string;
  username: string;
  display_name: string | null;
}

interface PenaltyRow extends Penalty {
  code_meta?: PenaltyCode | null;
  staff_name?: string;
}

interface ViolationCount {
  staff_id: string;
  staff_name: string;
  violations: number;
  total_amount: number;
}

export default function OwnerReviewPage() {
  const { user } = useAuthStore();
  const { currentStoreId } = useAppStore();
  const [storeName, setStoreName] = useState<string>('');

  // Role guard — render before hooks fire is fine because we still want
  // the redirect message for the wrong role. Hooks below run unconditionally.
  const allowed = !user || REVIEW_ROLES.includes(user.role);

  const [businessDate, setBusinessDate] = useState<string>(() => businessDateBangkok());
  const [loading, setLoading] = useState(true);

  // Owners screenshot the table to send to staff. By default the row list
  // is filtered to discrepancies only (matched rows are visual noise +
  // bloat the screenshot); toggle to show everything when needed.
  const [showAll, setShowAll] = useState(false);

  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [penalties, setPenalties] = useState<PenaltyRow[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [codes, setCodes] = useState<PenaltyCode[]>([]);
  const [violations, setViolations] = useState<ViolationCount[]>([]);
  const [lastTuesdayTransfer, setLastTuesdayTransfer] = useState<{
    tuesday: string;
    transferred_at: string | null;
  } | null>(null);

  // Inline editor state — keyed by comparison id so multiple rows can be
  // edited in parallel without one row's draft clobbering another's.
  const [drafts, setDrafts] = useState<
    Record<string, { conclusion?: string; remark?: string }>
  >({});
  const [savingCell, setSavingCell] = useState<string | null>(null);

  // Modal state
  const [recountModal, setRecountModal] = useState<{
    comparison: Comparison;
    quantity: string;
    notes: string;
  } | null>(null);
  const [penaltyModal, setPenaltyModal] = useState<{
    comparison: Comparison | null;       // null = ad-hoc / EXP-01
    code: string;
    staffId: string;
    amount: string;
    notes: string;
  } | null>(null);

  const monthYear = useMemo(
    () => businessDate.slice(0, 7),
    [businessDate],
  );

  // Lookup helpers
  const staffById = useMemo(() => {
    const m = new Map<string, StaffOption>();
    for (const s of staff) m.set(s.id, s);
    return m;
  }, [staff]);

  const codeByValue = useMemo(() => {
    const m = new Map<string, PenaltyCode>();
    for (const c of codes) m.set(c.code, c);
    return m;
  }, [codes]);

  // Map: comparison_id → most recent penalty attached (so the "Action"
  // cell can render the badge instead of the empty dropdown)
  const penaltyByComparison = useMemo(() => {
    const m = new Map<string, PenaltyRow>();
    for (const p of penalties) {
      if (p.comparison_id) m.set(p.comparison_id, p);
    }
    return m;
  }, [penalties]);

  // ────────────────────────────────────────────────────────────────────────
  // Data loading
  // ────────────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!currentStoreId || !allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();

    // Comparisons for this date — Owner sees everything, even matched
    // rows, because the review needs the full picture (manager Excel
    // includes matched items so unaccounted bottles are obvious).
    const compPromise = supabase
      .from('comparisons')
      .select('*')
      .eq('store_id', currentStoreId)
      .eq('comp_date', businessDate)
      .order('product_name', { ascending: true });

    // Staff list scoped to this store. user_stores join keeps the dropdown
    // small instead of dumping the whole org.
    const staffPromise = supabase
      .from('user_stores')
      .select('user_id, profiles!inner(id, username, display_name, active, role)')
      .eq('store_id', currentStoreId);

    const codesPromise = supabase
      .from('penalty_codes')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true });

    // Penalties this month for the quota strip + per-row badges.
    const penaltiesPromise = supabase
      .from('penalties')
      .select('*')
      .eq('store_id', currentStoreId)
      .eq('month_year', monthYear);

    // Last Tuesday check for EXP-01 prompt. We grab any transfer from
    // this store to HQ on the most recent Tuesday so the owner can decide
    // whether the deadline was missed.
    const lastTue = mostRecentTuesday(businessDate);
    const tuStart = `${lastTue}T00:00:00+07:00`;
    const tuEnd = `${lastTue}T23:59:59+07:00`;
    const transferPromise = supabase
      .from('transfers')
      .select('id, created_at')
      .eq('from_store_id', currentStoreId)
      .gte('created_at', tuStart)
      .lte('created_at', tuEnd)
      .order('created_at', { ascending: true })
      .limit(1);

    const storePromise = supabase
      .from('stores')
      .select('store_name')
      .eq('id', currentStoreId)
      .maybeSingle();

    const [
      compRes,
      staffRes,
      codesRes,
      penRes,
      transferRes,
      storeRes,
    ] = await Promise.all([
      compPromise,
      staffPromise,
      codesPromise,
      penaltiesPromise,
      transferPromise,
      storePromise,
    ]);

    if (storeRes.data?.store_name) setStoreName(storeRes.data.store_name);

    if (compRes.data) setComparisons(compRes.data as unknown as Comparison[]);
    if (codesRes.data) setCodes(codesRes.data as PenaltyCode[]);

    // Flatten the staff join + dedupe (a user_stores row can appear twice
    // if assignments overlap — keep the first).
    const staffList: StaffOption[] = [];
    const seen = new Set<string>();
    for (const row of (staffRes.data || []) as unknown as Array<{
      profiles: { id: string; username: string; display_name: string | null; active: boolean };
    }>) {
      const p = row.profiles;
      if (!p || !p.active || seen.has(p.id)) continue;
      seen.add(p.id);
      staffList.push({ id: p.id, username: p.username, display_name: p.display_name });
    }
    setStaff(staffList);

    // Decorate penalties with code meta + staff name for downstream UI.
    const codeMap = new Map((codesRes.data || []).map((c: PenaltyCode) => [c.code, c]));
    const staffMap = new Map(staffList.map((s) => [s.id, s]));
    const decorated: PenaltyRow[] = ((penRes.data || []) as Penalty[]).map((p) => ({
      ...p,
      code_meta: p.penalty_code ? codeMap.get(p.penalty_code) || null : null,
      staff_name:
        staffMap.get(p.staff_id)?.display_name ||
        staffMap.get(p.staff_id)?.username ||
        '—',
    }));
    setPenalties(decorated);

    // Aggregate violations into per-staff buckets for the quota strip.
    const buckets = new Map<string, ViolationCount>();
    for (const p of decorated) {
      if (!p.included_in_quota || p.status === 'cancelled') continue;
      const cur = buckets.get(p.staff_id) || {
        staff_id: p.staff_id,
        staff_name: p.staff_name || '—',
        violations: 0,
        total_amount: 0,
      };
      cur.violations += 1;
      cur.total_amount += Number(p.amount || 0);
      buckets.set(p.staff_id, cur);
    }
    setViolations(Array.from(buckets.values()).sort((a, b) => b.violations - a.violations));

    setLastTuesdayTransfer({
      tuesday: lastTue,
      transferred_at: transferRes.data?.[0]?.created_at || null,
    });

    setLoading(false);
  }, [currentStoreId, businessDate, monthYear, allowed]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ────────────────────────────────────────────────────────────────────────
  // Mutations — all go through RLS-protected supabase client
  // ────────────────────────────────────────────────────────────────────────

  const handleSaveCell = async (
    id: string,
    field: 'conclusion' | 'owner_notes',
    value: string,
  ) => {
    setSavingCell(`${id}:${field}`);
    const supabase = createClient();
    const { error } = await supabase
      .from('comparisons')
      .update({ [field]: value || null })
      .eq('id', id);
    setSavingCell(null);
    if (error) {
      toast({ type: 'error', title: 'บันทึกล้มเหลว', message: error.message });
      return;
    }
    setComparisons((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value || null } : c)),
    );
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleAssignResponsible = async (id: string, staffId: string) => {
    setSavingCell(`${id}:responsible`);
    const supabase = createClient();
    const { error } = await supabase
      .from('comparisons')
      .update({ responsible_staff_id: staffId || null })
      .eq('id', id);
    setSavingCell(null);
    if (error) {
      toast({ type: 'error', title: 'บันทึกล้มเหลว', message: error.message });
      return;
    }
    setComparisons((prev) =>
      prev.map((c) => (c.id === id ? { ...c, responsible_staff_id: staffId || null } : c)),
    );
  };

  const handleEscalateHR = async (c: Comparison) => {
    if (!user) return;
    const escalating = !c.escalated_to_hr_at;
    const supabase = createClient();
    const patch = escalating
      ? { escalated_to_hr_at: new Date().toISOString(), escalated_by: user.id }
      : { escalated_to_hr_at: null, escalated_by: null };
    const { error } = await supabase
      .from('comparisons')
      .update(patch)
      .eq('id', c.id);
    if (error) {
      toast({ type: 'error', title: 'บันทึกล้มเหลว', message: error.message });
      return;
    }
    setComparisons((prev) =>
      prev.map((row) => (row.id === c.id ? { ...row, ...patch } : row)),
    );
    toast({
      type: 'success',
      title: escalating ? 'ส่งเรื่องให้ HR แล้ว' : 'ยกเลิกการส่ง HR',
    });
  };

  const handleSubmitRecount = async () => {
    if (!recountModal || !user) return;
    const qty = Number(recountModal.quantity);
    if (!Number.isFinite(qty)) {
      toast({ type: 'error', title: 'กรุณาใส่ตัวเลข' });
      return;
    }
    const supabase = createClient();
    const { error } = await supabase
      .from('comparisons')
      .update({
        recount_quantity: qty,
        recount_by: user.id,
        recount_at: new Date().toISOString(),
        recount_notes: recountModal.notes || null,
      })
      .eq('id', recountModal.comparison.id);
    if (error) {
      toast({ type: 'error', title: 'บันทึกล้มเหลว', message: error.message });
      return;
    }
    setComparisons((prev) =>
      prev.map((c) =>
        c.id === recountModal.comparison.id
          ? {
              ...c,
              recount_quantity: qty,
              recount_by: user.id,
              recount_at: new Date().toISOString(),
              recount_notes: recountModal.notes || null,
            }
          : c,
      ),
    );
    setRecountModal(null);
    toast({ type: 'success', title: 'บันทึกการนับซ้ำแล้ว' });
  };

  const handleSubmitPenalty = async () => {
    if (!penaltyModal || !user || !currentStoreId) return;
    const code = codeByValue.get(penaltyModal.code);
    if (!code) {
      toast({ type: 'error', title: 'เลือกรหัสความผิดก่อน' });
      return;
    }
    if (!penaltyModal.staffId) {
      toast({ type: 'error', title: 'เลือกพนักงานที่รับผิดชอบ' });
      return;
    }
    const amount = penaltyModal.amount ? Number(penaltyModal.amount) : null;
    const supabase = createClient();
    const { error, data } = await supabase
      .from('penalties')
      .insert({
        store_id: currentStoreId,
        staff_id: penaltyModal.staffId,
        penalty_code: code.code,
        comparison_id: penaltyModal.comparison?.id || null,
        reason: code.label,
        amount,
        status: 'pending',
        notes: penaltyModal.notes || null,
        included_in_quota: code.included_in_quota,
        approved_by: user.id,
      })
      .select('*')
      .single();
    if (error) {
      toast({ type: 'error', title: 'บันทึกล้มเหลว', message: error.message });
      return;
    }
    const newPen: PenaltyRow = {
      ...(data as Penalty),
      code_meta: code,
      staff_name:
        staffById.get(penaltyModal.staffId)?.display_name ||
        staffById.get(penaltyModal.staffId)?.username ||
        '—',
    };
    setPenalties((prev) => [newPen, ...prev]);
    setPenaltyModal(null);
    toast({ type: 'success', title: `สร้าง ${code.code} แล้ว` });
    // Recompute violation buckets cheaply
    if (newPen.included_in_quota) {
      setViolations((prev) => {
        const next = [...prev];
        const idx = next.findIndex((v) => v.staff_id === newPen.staff_id);
        if (idx >= 0) {
          next[idx] = {
            ...next[idx],
            violations: next[idx].violations + 1,
            total_amount: next[idx].total_amount + Number(newPen.amount || 0),
          };
        } else {
          next.push({
            staff_id: newPen.staff_id,
            staff_name: newPen.staff_name || '—',
            violations: 1,
            total_amount: Number(newPen.amount || 0),
          });
        }
        return next.sort((a, b) => b.violations - a.violations);
      });
    }
  };

  const handleSendQuotaAlert = (v: ViolationCount) => {
    if (!currentStoreId) return;
    const name = storeName || 'สาขา';
    sendChatBotMessage({
      storeId: currentStoreId,
      type: 'system',
      content:
        `⚠️ แจ้งเตือนหัวหน้าบาร์ ${name} — ${v.staff_name} มีความผิดสะสม ${v.violations} ครั้ง ` +
        `ในเดือน ${monthYear} (เกินเกณฑ์ ${QUOTA_WARN} ครั้ง — ใกล้เกิน ${QUOTA_MAX} ครั้งที่กำหนด) ` +
        `กรุณาตรวจสอบและออกใบเตือนตาม SOP`,
    });
    toast({ type: 'success', title: 'ส่งแจ้งเตือนเข้าแชทสาขาแล้ว' });
  };

  // ────────────────────────────────────────────────────────────────────────
  // Render guards
  // ────────────────────────────────────────────────────────────────────────

  if (!allowed) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <Shield className="h-10 w-10 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          หน้านี้สำหรับผู้จัดการ / เจ้าของร้านเท่านั้น
        </p>
        <Link
          href="/stock"
          className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          กลับไปหน้าสต็อก
        </Link>
      </div>
    );
  }

  if (!currentStoreId) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="ยังไม่ได้เลือกสาขา"
        description="กรุณาเลือกสาขาจากเมนูด้านบนก่อน"
      />
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────

  const shiftDate = (delta: number) => {
    const [y, m, d] = businessDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    setBusinessDate(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
    );
  };

  const totalDiscrepancy = comparisons.filter(
    (c) => Math.abs(c.difference || 0) > 0.005,
  ).length;
  const pendingRecount = comparisons.filter(
    (c) => Math.abs(c.difference || 0) > 0.005 && c.recount_quantity === null,
  ).length;
  const escalatedCount = comparisons.filter((c) => c.escalated_to_hr_at).length;

  // Filtered list driven by the showAll toggle. Hides matched rows by
  // default so the screenshot only contains rows that need attention.
  const visibleComparisons = useMemo(
    () =>
      showAll
        ? comparisons
        : comparisons.filter((c) => Math.abs(c.difference || 0) > 0.005),
    [comparisons, showAll],
  );

  // Aggregate this store's monthly totals across every staff so the owner
  // sees one big number ("เดือนนี้บันทึกความผิดไปแล้ว N ครั้ง") regardless
  // of who got dinged. Excludes EXP-01 (those rows already have included_in_quota=false).
  const storeMonthTotals = useMemo(() => {
    let count = 0;
    let amount = 0;
    for (const v of violations) {
      count += v.violations;
      amount += v.total_amount;
    }
    return { count, amount };
  }, [violations]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/stock"
            className="mb-1 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
          >
            <ArrowLeft className="h-3 w-3" />
            กลับไปสต็อก
          </Link>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-white">
            รายการเจ้าของร้าน
          </h1>
          <p className="mt-0.5 text-xs text-gray-500 sm:text-sm dark:text-gray-400">
            ตรวจสอบ + นับซ้ำ + ออกบทลงโทษตามระเบียบ SOP
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => shiftDate(-1)}
            className="h-9 w-9 p-0"
            aria-label="วันก่อนหน้า"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <input
            type="date"
            value={businessDate}
            max={businessDateBangkok()}
            onChange={(e) => e.target.value && setBusinessDate(e.target.value)}
            className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => shiftDate(1)}
            disabled={businessDate >= businessDateBangkok()}
            className="h-9 w-9 p-0"
            aria-label="วันถัดไป"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Store-wide monthly violation banner — answers the "เดือนนี้สาขานี้
          บันทึกผิดไปแล้วกี่ครั้ง" question owners ask first when they open
          this page. */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-xl px-4 py-3',
          storeMonthTotals.count >= QUOTA_MAX
            ? 'bg-red-50 ring-1 ring-red-200 dark:bg-red-900/20 dark:ring-red-800'
            : storeMonthTotals.count >= QUOTA_WARN
              ? 'bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:ring-amber-800'
              : 'bg-indigo-50 ring-1 ring-indigo-200 dark:bg-indigo-900/20 dark:ring-indigo-800',
        )}
      >
        <Calendar className="h-5 w-5 text-gray-500" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            สาขา{storeName ? ` ${storeName}` : ''} — เดือน {monthYear}
          </p>
          <p className="text-base font-bold text-gray-900 dark:text-white">
            บันทึกความผิดแล้ว{' '}
            <span className="tabular-nums">{storeMonthTotals.count}</span> ครั้ง
            {storeMonthTotals.amount > 0 && (
              <span className="ml-2 text-sm font-medium text-gray-600 dark:text-gray-300">
                (ค่าปรับสะสม {formatNumber(storeMonthTotals.amount)} บาท)
              </span>
            )}
          </p>
        </div>
        <Badge
          variant={
            storeMonthTotals.count >= QUOTA_MAX
              ? 'danger'
              : storeMonthTotals.count >= QUOTA_WARN
                ? 'warning'
                : 'info'
          }
        >
          {storeMonthTotals.count >= QUOTA_MAX
            ? `≥ ${QUOTA_MAX} (ครบโควตา)`
            : storeMonthTotals.count >= QUOTA_WARN
              ? `≥ ${QUOTA_WARN} (ใกล้เกิน)`
              : `≤ ${QUOTA_WARN} (ปกติ)`}
        </Badge>
      </div>

      {/* Per-day summary chips */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryChip label="รายการทั้งหมด" value={comparisons.length} icon={ClipboardList} tone="gray" />
        <SummaryChip label="ผลต่าง" value={totalDiscrepancy} icon={AlertTriangle} tone="amber" />
        <SummaryChip label="ยังไม่ได้นับซ้ำ" value={pendingRecount} icon={RotateCcw} tone="rose" />
        <SummaryChip label="ส่ง HR แล้ว" value={escalatedCount} icon={Send} tone="violet" />
      </div>

      {/* Quota strip — only show staff with actual violations this month */}
      {violations.length > 0 && (
        <Card>
          <CardHeader title={`คะแนนความผิดเดือน ${monthYear}`} />
          <CardContent>
            <div className="space-y-2">
              {violations.map((v) => {
                const overWarn = v.violations >= QUOTA_WARN;
                const overMax = v.violations >= QUOTA_MAX;
                const tone = overMax ? 'red' : overWarn ? 'amber' : 'emerald';
                return (
                  <div
                    key={v.staff_id}
                    className={cn(
                      'flex flex-wrap items-center gap-3 rounded-lg px-3 py-2',
                      tone === 'red' && 'bg-red-50 dark:bg-red-900/20',
                      tone === 'amber' && 'bg-amber-50 dark:bg-amber-900/20',
                      tone === 'emerald' && 'bg-emerald-50 dark:bg-emerald-900/20',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {v.staff_name}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-300">
                        {v.violations} / {QUOTA_MAX} ครั้ง — ค่าปรับสะสม{' '}
                        {formatNumber(v.total_amount)} บาท
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={overMax ? 'danger' : overWarn ? 'warning' : 'success'}>
                        {overMax ? 'ครบโควตา' : overWarn ? 'ใกล้เกิน' : 'ปกติ'}
                      </Badge>
                      {overWarn && (
                        <Button
                          size="sm"
                          variant="outline"
                          icon={<Megaphone className="h-3.5 w-3.5" />}
                          onClick={() => handleSendQuotaAlert(v)}
                        >
                          แจ้งเตือนแชทสาขา
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* EXP-01 reminder card */}
      {lastTuesdayTransfer && (
        <Card>
          <CardHeader title="ตรวจสอบการส่งเหล้าหมดอายุคืน HQ (EXP-01)" />
          <CardContent>
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-700/50">
              <Calendar className="h-5 w-5 text-gray-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 dark:text-white">
                  วันอังคารล่าสุด:{' '}
                  <span className="font-semibold">
                    {formatThaiDate(lastTuesdayTransfer.tuesday)}
                  </span>
                </p>
                {lastTuesdayTransfer.transferred_at ? (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    ส่งคืน HQ เวลา{' '}
                    {new Date(lastTuesdayTransfer.transferred_at).toLocaleTimeString('th-TH', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Bangkok',
                    })}{' '}
                    น. — ตรงกำหนด 18:00–18:20 ให้ตรวจสอบเองอีกครั้ง
                  </p>
                ) : (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-rose-700 dark:text-rose-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    ยังไม่พบการส่งคืน HQ — อาจเข้าข่าย EXP-01 (ปรับ 100 บ./วัน)
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => {
                  const exp01 = codes.find((c) => c.code === 'EXP-01');
                  setPenaltyModal({
                    comparison: null,
                    code: exp01?.code || 'EXP-01',
                    staffId: '',
                    amount: String(exp01?.default_amount ?? 100),
                    notes: `ส่งเหล้าหมดอายุคืน HQ ช้า — วันที่ ${lastTuesdayTransfer.tuesday}`,
                  });
                }}
              >
                สร้าง EXP-01
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main table */}
      <Card padding="none">
        <CardHeader
          title={`รายการสำหรับวันที่ ${formatThaiDate(businessDate)}`}
          action={
            <Button
              size="sm"
              variant="outline"
              icon={
                showAll ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )
              }
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll
                ? `ซ่อนรายการที่ตรง (${comparisons.length - totalDiscrepancy})`
                : `แสดงทั้งหมด (${comparisons.length})`}
            </Button>
          }
        />
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
          </div>
        ) : comparisons.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="ยังไม่มีรายการเปรียบเทียบ"
            description="กดเปรียบเทียบในหน้า /stock/comparison ก่อน"
          />
        ) : visibleComparisons.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
            <p className="text-sm text-gray-600 dark:text-gray-300">
              ทุกรายการตรงพอดี — ไม่มีผลต่างให้รีวิว
            </p>
            <p className="mt-1 text-xs text-gray-400">
              กด "แสดงทั้งหมด" ด้านบนเพื่อดูรายการที่ตรง
            </p>
          </div>
        ) : (
          // Cap height + sticky thead so the header still shows in
          // screenshots when the row list is long. max-h tuned to fit a
          // typical laptop viewport without dwarfing smaller phones.
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="sticky top-0 z-10 bg-pink-50 text-gray-700 shadow-sm dark:bg-pink-900/40 dark:text-gray-200">
                <tr>
                  <Th>สินค้า</Th>
                  <Th align="right">POS</Th>
                  <Th align="right">นับได้</Th>
                  <Th align="right">ผลต่าง</Th>
                  <Th align="right">นับสอบ</Th>
                  <Th>สรุป</Th>
                  <Th>ผู้รับผิดชอบ</Th>
                  <Th>บทลงโทษ</Th>
                  <Th>หมายเหตุ</Th>
                  <Th align="center">HR</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {visibleComparisons.map((c) => {
                  const diff = c.difference || 0;
                  const draft = drafts[c.id] || {};
                  const linkedPenalty = penaltyByComparison.get(c.id);
                  const isSavingConclusion = savingCell === `${c.id}:conclusion`;
                  const isSavingNotes = savingCell === `${c.id}:owner_notes`;
                  return (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      {/* Product */}
                      <td className="px-3 py-2 align-top">
                        <p className="font-medium text-gray-900 dark:text-white">
                          {c.product_name || '—'}
                        </p>
                        <p className="text-[10px] text-gray-400">{c.product_code}</p>
                      </td>
                      {/* POS */}
                      <td className="px-3 py-2 text-right align-top tabular-nums">
                        {formatQty(c.pos_quantity)}
                      </td>
                      {/* Manual */}
                      <td className="px-3 py-2 text-right align-top tabular-nums">
                        {formatQty(c.manual_quantity)}
                      </td>
                      {/* Diff */}
                      <td
                        className={cn(
                          'px-3 py-2 text-right align-top tabular-nums font-semibold',
                          diff > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : diff < 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-gray-500',
                        )}
                      >
                        {formatSignedQty(c.difference)}
                      </td>
                      {/* Recount */}
                      <td className="px-3 py-2 text-right align-top">
                        <button
                          type="button"
                          onClick={() =>
                            setRecountModal({
                              comparison: c,
                              quantity:
                                c.recount_quantity !== null
                                  ? String(c.recount_quantity)
                                  : '',
                              notes: c.recount_notes || '',
                            })
                          }
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs',
                            c.recount_quantity !== null
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                              : 'border-dashed border-gray-300 text-gray-500 hover:border-indigo-400 hover:text-indigo-600',
                          )}
                        >
                          {c.recount_quantity !== null
                            ? formatQty(c.recount_quantity)
                            : '+ นับซ้ำ'}
                          {c.recount_by && (
                            <span className="text-[10px] opacity-70">
                              ({initials(staffById.get(c.recount_by))})
                            </span>
                          )}
                        </button>
                      </td>
                      {/* Conclusion */}
                      <td className="px-3 py-2 align-top min-w-[160px]">
                        <Textarea
                          value={draft.conclusion ?? c.conclusion ?? ''}
                          rows={1}
                          placeholder="สรุปสาเหตุ…"
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [c.id]: { ...prev[c.id], conclusion: e.target.value },
                            }))
                          }
                          onBlur={() => {
                            if (
                              draft.conclusion !== undefined &&
                              draft.conclusion !== (c.conclusion ?? '')
                            ) {
                              handleSaveCell(c.id, 'conclusion', draft.conclusion);
                            }
                          }}
                          className="min-h-[34px] !py-1.5 text-xs"
                        />
                        {isSavingConclusion && (
                          <Loader2 className="mt-1 h-3 w-3 animate-spin text-gray-400" />
                        )}
                      </td>
                      {/* Responsible */}
                      <td className="px-3 py-2 align-top min-w-[140px]">
                        <Select
                          value={c.responsible_staff_id ?? ''}
                          options={[
                            { value: '', label: '— เลือก —' },
                            ...staff.map((s) => ({
                              value: s.id,
                              label: s.display_name || s.username,
                            })),
                          ]}
                          onChange={(e) => handleAssignResponsible(c.id, e.target.value)}
                          className="!py-1.5 text-xs"
                        />
                      </td>
                      {/* Penalty */}
                      <td className="px-3 py-2 align-top min-w-[160px]">
                        {linkedPenalty ? (
                          <div className="flex flex-col gap-0.5">
                            <Badge variant={penaltyBadgeVariant(linkedPenalty.code_meta?.level)}>
                              {linkedPenalty.penalty_code}
                            </Badge>
                            <span className="text-[10px] text-gray-500 truncate">
                              {linkedPenalty.staff_name}
                              {linkedPenalty.amount
                                ? ` · ${formatNumber(Number(linkedPenalty.amount))}฿`
                                : ''}
                            </span>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            icon={<Plus className="h-3 w-3" />}
                            onClick={() => {
                              const candidates = codes.filter((cc) => cc.code !== 'EXP-01');
                              const first = candidates[0];
                              setPenaltyModal({
                                comparison: c,
                                code: first?.code || '',
                                staffId: c.responsible_staff_id || '',
                                amount: first?.default_amount ? String(first.default_amount) : '',
                                notes: '',
                              });
                            }}
                          >
                            ออกโทษ
                          </Button>
                        )}
                      </td>
                      {/* Remark (owner_notes) */}
                      <td className="px-3 py-2 align-top min-w-[140px]">
                        <Textarea
                          value={draft.remark ?? c.owner_notes ?? ''}
                          rows={1}
                          placeholder="หมายเหตุ…"
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [c.id]: { ...prev[c.id], remark: e.target.value },
                            }))
                          }
                          onBlur={() => {
                            if (
                              draft.remark !== undefined &&
                              draft.remark !== (c.owner_notes ?? '')
                            ) {
                              handleSaveCell(c.id, 'owner_notes', draft.remark);
                            }
                          }}
                          className="min-h-[34px] !py-1.5 text-xs"
                        />
                        {isSavingNotes && (
                          <Loader2 className="mt-1 h-3 w-3 animate-spin text-gray-400" />
                        )}
                      </td>
                      {/* HR */}
                      <td className="px-3 py-2 text-center align-top">
                        <button
                          type="button"
                          onClick={() => handleEscalateHR(c)}
                          className={cn(
                            'inline-flex h-7 w-7 items-center justify-center rounded-md border',
                            c.escalated_to_hr_at
                              ? 'border-violet-300 bg-violet-100 text-violet-700 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                              : 'border-gray-300 text-gray-400 hover:border-violet-400 hover:text-violet-600',
                          )}
                          title={c.escalated_to_hr_at ? 'ยกเลิกการส่ง HR' : 'ส่งเรื่องให้ HR'}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Penalty codes quick reference */}
      <Card>
        <CardHeader title="อ้างอิงรหัสความผิด (SOP)" />
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {codes.map((c) => (
              <div
                key={c.code}
                className="rounded-lg border border-gray-200 bg-white p-2.5 text-xs dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={penaltyBadgeVariant(c.level)}>{c.code}</Badge>
                  {!c.included_in_quota && (
                    <span className="text-[10px] text-gray-400">ไม่นับ quota</span>
                  )}
                </div>
                <p className="mt-1 font-medium text-gray-900 dark:text-white">{c.label}</p>
                {c.description && (
                  <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                    {c.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recount modal */}
      <Modal
        isOpen={!!recountModal}
        onClose={() => setRecountModal(null)}
        title="นับสอบ (Recount)"
      >
        {recountModal && (
          <div className="space-y-3">
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-700/50">
              <p className="font-semibold">{recountModal.comparison.product_name}</p>
              <p className="text-xs text-gray-500">
                POS {formatQty(recountModal.comparison.pos_quantity)} · นับได้{' '}
                {formatQty(recountModal.comparison.manual_quantity)} · ผลต่าง{' '}
                <span
                  className={cn(
                    (recountModal.comparison.difference || 0) < 0
                      ? 'text-rose-600'
                      : 'text-emerald-600',
                  )}
                >
                  {formatSignedQty(recountModal.comparison.difference)}
                </span>
              </p>
            </div>
            <Input
              type="number"
              step="0.01"
              label="ยอดที่นับสอบได้"
              value={recountModal.quantity}
              onChange={(e) =>
                setRecountModal((prev) => prev && { ...prev, quantity: e.target.value })
              }
              autoFocus
            />
            <Textarea
              label="หมายเหตุ (ถ้ามี)"
              value={recountModal.notes}
              onChange={(e) =>
                setRecountModal((prev) => prev && { ...prev, notes: e.target.value })
              }
              rows={2}
            />
            <ModalFooter>
              <Button variant="outline" onClick={() => setRecountModal(null)}>
                ยกเลิก
              </Button>
              <Button onClick={handleSubmitRecount}>บันทึก</Button>
            </ModalFooter>
          </div>
        )}
      </Modal>

      {/* Penalty modal */}
      <Modal
        isOpen={!!penaltyModal}
        onClose={() => setPenaltyModal(null)}
        title="ออกบทลงโทษ"
      >
        {penaltyModal && (
          <div className="space-y-3">
            {penaltyModal.comparison && (
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-700/50">
                <p className="font-semibold">
                  {penaltyModal.comparison.product_name}
                </p>
                <p className="text-xs text-gray-500">
                  ผลต่าง{' '}
                  <span
                    className={cn(
                      (penaltyModal.comparison.difference || 0) < 0
                        ? 'text-rose-600'
                        : 'text-emerald-600',
                    )}
                  >
                    {formatSignedQty(penaltyModal.comparison.difference)}
                  </span>
                </p>
              </div>
            )}
            <Select
              label="รหัสความผิด"
              value={penaltyModal.code}
              options={codes.map((c) => ({
                value: c.code,
                label: `${c.code} — ${c.label}`,
              }))}
              onChange={(e) => {
                const code = codeByValue.get(e.target.value);
                setPenaltyModal((prev) =>
                  prev && {
                    ...prev,
                    code: e.target.value,
                    amount: code?.default_amount ? String(code.default_amount) : '',
                  },
                );
              }}
            />
            <Select
              label="พนักงานที่รับผิดชอบ"
              value={penaltyModal.staffId}
              options={[
                { value: '', label: '— เลือก —' },
                ...staff.map((s) => ({
                  value: s.id,
                  label: s.display_name || s.username,
                })),
              ]}
              onChange={(e) =>
                setPenaltyModal((prev) => prev && { ...prev, staffId: e.target.value })
              }
            />
            <Input
              type="number"
              step="0.01"
              label="ค่าปรับ (บาท) — เว้นว่างถ้าไม่ใช่หักเงิน"
              value={penaltyModal.amount}
              onChange={(e) =>
                setPenaltyModal((prev) => prev && { ...prev, amount: e.target.value })
              }
            />
            <Textarea
              label="โน๊ต"
              value={penaltyModal.notes}
              onChange={(e) =>
                setPenaltyModal((prev) => prev && { ...prev, notes: e.target.value })
              }
              rows={2}
            />
            <ModalFooter>
              <Button variant="outline" onClick={() => setPenaltyModal(null)}>
                ยกเลิก
              </Button>
              <Button onClick={handleSubmitPenalty}>บันทึก</Button>
            </ModalFooter>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Small helpers + presentational components
// ────────────────────────────────────────────────────────────────────────────

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      className={cn(
        'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
      )}
    >
      {children}
    </th>
  );
}

function SummaryChip({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'gray' | 'amber' | 'rose' | 'violet';
}) {
  const toneClass = {
    gray: 'bg-gray-50 text-gray-700 dark:bg-gray-700/40',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
    rose: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
    violet: 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300',
  }[tone];
  return (
    <div className={cn('flex items-center gap-3 rounded-xl px-3 py-3', toneClass)}>
      <Icon className="h-5 w-5 opacity-70" />
      <div className="min-w-0">
        <p className="text-xs opacity-80">{label}</p>
        <p className="text-lg font-bold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function initials(staff: StaffOption | undefined): string {
  if (!staff) return '?';
  const name = staff.display_name || staff.username || '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function penaltyBadgeVariant(level?: PenaltyCode['level'] | null): 'default' | 'info' | 'warning' | 'danger' | 'success' {
  switch (level) {
    case 'notify':
      return 'info';
    case 'suspend':
      return 'warning';
    case 'fine':
      return 'warning';
    case 'compensate':
      return 'warning';
    case 'terminate':
      return 'danger';
    default:
      return 'default';
  }
}

// Most recent Tuesday on or before the given YYYY-MM-DD (Bangkok day).
// Used by the EXP-01 reminder card.
function mostRecentTuesday(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay(); // 0 = Sun .. 2 = Tue
  const diff = (dow - 2 + 7) % 7; // days since last Tuesday
  dt.setDate(dt.getDate() - diff);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
