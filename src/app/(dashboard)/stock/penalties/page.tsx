'use client';

/**
 * Stock Penalties — HQ management surface for the stock-SOP / penalty system (owner ask 2026-07-09).
 * See docs/hr/stock-penalty-to-hr.md. HQ (owner / hq / can_manage_stock_sop) sees, per store + month:
 *   • the monthly SOP point total vs the warning threshold (progress bar),
 *   • the weekly A-02 occurrence breakdown,
 *   • an Auto/Manual toggle for whether crossing the threshold auto-warns the head_bar,
 *   • a manual "send warning to head_bar" button (Manual mode),
 *   • an ad-hoc SV (Service Charge) deduction tool (outside the SOP engine), and
 *   • the recent penalty feed for the store/month.
 * Read + mutate via /api/stock/penalties/* — every route re-checks auth server-side.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import { useAppStore } from '@/stores/app-store';
import { useAuthStore } from '@/stores/auth-store';
import { hasPermission } from '@/lib/auth/permissions';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Input,
  Modal,
  ModalFooter,
  PageHeader,
  Select,
  StatusBadge,
  type StatusTone,
  toast,
} from '@/components/ui';
import { openBusinessDateBangkok } from '@/lib/utils/date';
import { formatThaiDate } from '@/lib/utils/format';
import {
  AlertTriangle,
  Banknote,
  ClipboardList,
  Gauge,
  Loader2,
  Megaphone,
  Minus,
  Send,
  Shield,
} from 'lucide-react';

interface WeekOccurrence {
  week_key: string;
  occurrences: number;
}

interface RecentPenalty {
  id: string;
  penalty_code: string | null;
  reason: string | null;
  amount: number | null;
  status: string | null;
  business_date: string | null;
  created_at: string;
  included_in_quota: boolean | null;
  staff_name?: string;
}

interface MoneyBucket {
  count: number;
  baht: number;
}

interface MoneyBreakdown {
  pending: MoneyBucket;
  sent_hr: MoneyBucket;
  deducted: MoneyBucket;
}

interface SummaryResponse {
  sop_points: number;
  threshold: number;
  auto_hr: boolean;
  week_summary: WeekOccurrence[];
  recent: RecentPenalty[];
  money?: MoneyBreakdown;
}

interface StoreMember {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
}

const EMPTY_MONEY: MoneyBreakdown = {
  pending: { count: 0, baht: 0 },
  sent_hr: { count: 0, baht: 0 },
  deducted: { count: 0, baht: 0 },
};

function bahtLabel(amount: number): string {
  return amount.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

type TileTone = 'default' | 'rose' | 'amber' | 'info';

const tileToneCls: Record<TileTone, { box: string; value: string }> = {
  default: {
    box: 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
    value: 'text-gray-900 dark:text-white',
  },
  rose: {
    box: 'border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-900/20',
    value: 'text-rose-600 dark:text-rose-400',
  },
  amber: {
    box: 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20',
    value: 'text-amber-700 dark:text-amber-300',
  },
  info: {
    box: 'border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-900/20',
    value: 'text-blue-700 dark:text-blue-300',
  },
};

// SummaryTile — one compact KPI on the top summary grid (2-up on phones, 4-up on desktop).
function SummaryTile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: TileTone;
}) {
  const cls = tileToneCls[tone];
  return (
    <div className={cn('min-w-0 rounded-xl border p-3', cls.box)}>
      <p className="truncate text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className={cn('mt-1 truncate text-xl font-bold tabular-nums', cls.value)}>{value}</p>
      {sub ? <p className="mt-0.5 truncate text-[11px] text-gray-400">{sub}</p> : null}
    </div>
  );
}

export default function StockPenaltiesPage() {
  const isTh = useLocale() === 'th';
  const { currentStoreId } = useAppStore();
  const { user } = useAuthStore();

  const L = isTh
    ? {
        title: 'หักคะแนน/ค่าปรับสต๊อก',
        subtitle: 'สรุป SOP รายสัปดาห์/เดือน + ส่งใบเตือน + หัก SV (สำหรับ HQ)',
        pickStore: 'ยังไม่ได้เลือกสาขา',
        pickStoreDesc: 'กรุณาเลือกสาขาจากเมนูด้านบนก่อน',
        forbidden: 'หน้านี้สำหรับ HQ / เจ้าของร้านเท่านั้น',
        back: 'กลับไปหน้าสต็อก',
        monthPoints: 'แต้มความผิดเดือนนี้',
        overThreshold: 'เกินเกณฑ์เตือนแล้ว',
        underThreshold: 'ยังไม่ถึงเกณฑ์เตือน',
        weeklyTitle: 'ครั้งต่อสัปดาห์ (A-02)',
        noWeekly: 'ยังไม่มีครั้ง A-02 ในเดือนนี้',
        week: 'สัปดาห์',
        times: 'ครั้ง',
        modeTitle: 'โหมดส่งใบเตือน HR',
        modeAuto: 'อัตโนมัติ',
        modeManual: 'ด้วยตนเอง',
        modeAutoHint: 'เมื่อแต้มครบเกณฑ์ ระบบจะออกใบเตือนหัวหน้าบาร์อัตโนมัติ',
        modeManualHint: 'เมื่อแต้มครบเกณฑ์ HQ กดส่งใบเตือนเอง',
        sendWarning: 'ส่งใบเตือนหัวหน้าบาร์',
        adhoc: 'หัก Ad-hoc (นอก SOP)',
        recentTitle: 'รายการล่าสุด',
        noRecent: 'ยังไม่มีรายการในเดือนนี้',
        noCharge: 'ไม่หัก',
        loadFail: 'โหลดไม่สำเร็จ',
        savedMode: 'บันทึกโหมดแล้ว',
        adhocTitle: 'หัก SV แบบ Ad-hoc',
        adhocDesc: 'หักยอด Service Charge ของพนักงานนอกระบบ SOP (ต้องมีกอง SC เดือนนี้)',
        employee: 'พนักงาน',
        pickEmployee: '— เลือกพนักงาน —',
        reason: 'เหตุผล',
        amountBaht: 'จำนวนเงิน (บาท)',
        cancel: 'ยกเลิก',
        save: 'บันทึก',
        adhocDone: 'หัก SV เรียบร้อย',
        warnIssued: 'ออกใบเตือนหัวหน้าบาร์แล้ว',
        warnAlready: 'เดือนนี้ออกใบเตือนไปแล้ว',
        warnNoHead: 'ไม่พบหัวหน้าบาร์ของสาขานี้',
        warnManual: 'แจ้ง HQ/เจ้าของแล้ว (ยังไม่ออกใบเตือน)',
        warnDone: 'ดำเนินการแล้ว',
        // Summary tiles
        tileSop: 'แต้ม SOP',
        tileMoneyMonth: 'ค่าปรับเดือนนี้',
        tilePendingHr: 'รอส่ง HR',
        tileSentHr: 'ส่ง HR แล้ว',
        // Money-deduction status + action
        moneyPending: 'ค่าปรับรอส่ง HR',
        moneySent: 'ส่ง HR แล้ว — รอ HR หัก',
        moneyDeductedAll: 'หักครบแล้วเดือนนี้',
        sendToHr: 'ส่งเรื่องหักให้ HR',
        sentToHrDone: (n: number) => `ส่งให้ HR แล้ว ${n} รายการ`,
        items: 'รายการ',
        // Recent split + status badges
        activeTitle: 'กำลังดำเนินการ',
        historyTitle: 'ประวัติ (หักแล้ว)',
        stSopMark: 'แต้ม SOP',
        stToSend: 'รอส่ง HR',
        stSentHr: 'ส่ง HR แล้ว',
        stDeducted: 'หักแล้ว',
        stCancelled: 'ยกเลิก',
      }
    : {
        title: 'Stock penalties',
        subtitle: 'Weekly/monthly SOP summary + warnings + SV deductions (HQ)',
        pickStore: 'No store selected',
        pickStoreDesc: 'Please pick a store from the top menu first',
        forbidden: 'This page is for HQ / owners only',
        back: 'Back to stock',
        monthPoints: 'SOP points this month',
        overThreshold: 'Over the warning threshold',
        underThreshold: 'Under the warning threshold',
        weeklyTitle: 'Occurrences per week (A-02)',
        noWeekly: 'No A-02 occurrences this month',
        week: 'Week',
        times: '',
        modeTitle: 'HR warning mode',
        modeAuto: 'Auto',
        modeManual: 'Manual',
        modeAutoHint: 'On crossing the threshold, the head_bar warning is issued automatically',
        modeManualHint: 'On crossing the threshold, HQ sends the warning manually',
        sendWarning: 'Send warning to head_bar',
        adhoc: 'Ad-hoc deduction (off-SOP)',
        recentTitle: 'Recent penalties',
        noRecent: 'No penalties this month',
        noCharge: '—',
        loadFail: 'Load failed',
        savedMode: 'Mode saved',
        adhocTitle: 'Ad-hoc SV deduction',
        adhocDesc: 'Dock a person’s Service Charge outside the SOP engine (an SC pool must exist this month)',
        employee: 'Employee',
        pickEmployee: '— pick an employee —',
        reason: 'Reason',
        amountBaht: 'Amount (baht)',
        cancel: 'Cancel',
        save: 'Save',
        adhocDone: 'SV deducted',
        warnIssued: 'Warning issued to the head_bar',
        warnAlready: 'A warning was already issued this month',
        warnNoHead: 'No head_bar found for this store',
        warnManual: 'HQ/owner notified (no warning issued)',
        warnDone: 'Done',
        // Summary tiles
        tileSop: 'SOP points',
        tileMoneyMonth: 'Fines this month',
        tilePendingHr: 'To send to HR',
        tileSentHr: 'Sent to HR',
        // Money-deduction status + action
        moneyPending: 'Fines to send to HR',
        moneySent: 'Sent to HR — awaiting deduction',
        moneyDeductedAll: 'All deducted this month',
        sendToHr: 'Send deduction to HR',
        sentToHrDone: (n: number) => `Sent ${n} item(s) to HR`,
        items: 'items',
        // Recent split + status badges
        activeTitle: 'In progress',
        historyTitle: 'History (deducted)',
        stSopMark: 'SOP mark',
        stToSend: 'To send',
        stSentHr: 'Sent to HR',
        stDeducted: 'Deducted',
        stCancelled: 'Cancelled',
      };

  const canManage = !user || hasPermission(user, 'can_manage_stock_sop');

  const [month, setMonth] = useState<string>(() => openBusinessDateBangkok().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [members, setMembers] = useState<StoreMember[]>([]);
  const [savingMode, setSavingMode] = useState(false);
  const [sendingWarning, setSendingWarning] = useState(false);
  const [sendingToHr, setSendingToHr] = useState(false);

  const [adhoc, setAdhoc] = useState<{ userId: string; reason: string; amount: string } | null>(null);
  const [submittingAdhoc, setSubmittingAdhoc] = useState(false);

  const loadSummary = useCallback(async () => {
    if (!currentStoreId || !canManage) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/stock/penalties/summary?store_id=${encodeURIComponent(currentStoreId)}&month=${month}`,
      );
      if (!res.ok) throw new Error('load failed');
      const json = (await res.json()) as SummaryResponse;
      setSummary(json);
    } catch {
      toast({ type: 'error', title: L.loadFail });
      setSummary(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStoreId, month, canManage]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Store members for the ad-hoc employee picker — mirror owner-review's user_stores + profiles join.
  useEffect(() => {
    if (!currentStoreId || !canManage) return;
    const supabase = createClient();
    supabase
      .from('user_stores')
      .select('user_id, profiles!inner(id, username, display_name, active, role)')
      .eq('store_id', currentStoreId)
      .then(({ data }) => {
        const list: StoreMember[] = [];
        const seen = new Set<string>();
        for (const row of (data || []) as unknown as Array<{
          profiles: { id: string; username: string; display_name: string | null; active: boolean; role: string };
        }>) {
          const p = row.profiles;
          if (!p || !p.active || seen.has(p.id)) continue;
          seen.add(p.id);
          list.push({ id: p.id, username: p.username, display_name: p.display_name, role: p.role });
        }
        list.sort((a, b) =>
          (a.display_name || a.username).localeCompare(b.display_name || b.username, 'th'),
        );
        setMembers(list);
      });
  }, [currentStoreId, canManage]);

  const overThreshold = !!summary && summary.sop_points >= summary.threshold;
  const progressPct = useMemo(() => {
    if (!summary || summary.threshold <= 0) return 0;
    return Math.min(100, Math.round((summary.sop_points / summary.threshold) * 100));
  }, [summary]);

  const money = summary?.money ?? EMPTY_MONEY;
  const moneyTotalBaht = money.pending.baht + money.sent_hr.baht + money.deducted.baht;

  // Split the recent feed: deducted fines drop into a collapsible history; everything else
  // (pending/sent_hr money + SOP/notify marks + cancelled) stays in the active view.
  const recentRows = summary?.recent ?? [];
  const activeRecent = recentRows.filter((p) => p.status !== 'deducted');
  const deductedRecent = recentRows.filter((p) => p.status === 'deducted');

  const employeeOptions = useMemo(
    () => [
      { value: '', label: L.pickEmployee },
      ...members.map((m) => ({ value: m.id, label: m.display_name || m.username })),
    ],
    [members, L.pickEmployee],
  );

  const handleSetMode = async (nextAuto: boolean) => {
    if (!summary || savingMode || summary.auto_hr === nextAuto) return;
    setSavingMode(true);
    try {
      const res = await fetch('/api/stock/penalties/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_hr: nextAuto }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; auto_hr?: boolean };
      if (!res.ok) {
        toast({ type: 'error', title: json.error || L.loadFail });
        return;
      }
      setSummary((prev) => (prev ? { ...prev, auto_hr: !!json.auto_hr } : prev));
      toast({ type: 'success', title: L.savedMode });
    } finally {
      setSavingMode(false);
    }
  };

  const handleSendWarning = async () => {
    if (!currentStoreId || sendingWarning) return;
    setSendingWarning(true);
    try {
      const res = await fetch('/api/stock/penalties/issue-warning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: currentStoreId, month }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        issued?: boolean;
        reason?: string;
      };
      if (!res.ok) {
        toast({ type: 'error', title: json.error || L.loadFail });
        return;
      }
      // Map the shared issuer's result to a human message.
      if (json.issued) {
        toast({ type: 'success', title: L.warnIssued });
      } else if (json.reason === 'already_alerted') {
        toast({ type: 'info', title: L.warnAlready });
      } else if (json.reason === 'no_head_bar') {
        toast({ type: 'error', title: L.warnNoHead });
      } else if (json.reason === 'manual_mode') {
        toast({ type: 'info', title: L.warnManual });
      } else {
        toast({ type: 'success', title: L.warnDone });
      }
      loadSummary();
    } finally {
      setSendingWarning(false);
    }
  };

  const handleSendToHr = async () => {
    if (!currentStoreId || sendingToHr) return;
    setSendingToHr(true);
    try {
      const res = await fetch('/api/stock/penalties/send-to-hr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: currentStoreId, month }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        data?: { sent?: number };
      };
      if (!res.ok) {
        toast({ type: 'error', title: json.error || L.loadFail });
        return;
      }
      toast({ type: 'success', title: L.sentToHrDone(json.data?.sent ?? 0) });
      loadSummary();
    } finally {
      setSendingToHr(false);
    }
  };

  const handleSubmitAdhoc = async () => {
    if (!adhoc || !currentStoreId || submittingAdhoc) return;
    if (!adhoc.userId) {
      toast({ type: 'error', title: L.employee });
      return;
    }
    const amount = Number(adhoc.amount);
    if (!adhoc.reason.trim()) {
      toast({ type: 'error', title: L.reason });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ type: 'error', title: L.amountBaht });
      return;
    }
    setSubmittingAdhoc(true);
    try {
      const res = await fetch('/api/stock/penalties/adhoc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: currentStoreId,
          period_month: month,
          user_id: adhoc.userId,
          reason: adhoc.reason.trim(),
          amount,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) {
        toast({ type: 'error', title: json.error || L.loadFail });
        return;
      }
      toast({ type: 'success', title: L.adhocDone });
      setAdhoc(null);
      loadSummary();
    } finally {
      setSubmittingAdhoc(false);
    }
  };

  // Row badge: amount-less rows are SOP marks; money rows follow the pending → sent_hr → deducted
  // workflow. Cancelled is terminal regardless of amount.
  const rowStatusMeta = (p: RecentPenalty): { tone: StatusTone; label: string } => {
    if (p.status === 'cancelled') return { tone: 'neutral', label: L.stCancelled };
    const hasCharge = !!p.amount && p.amount > 0;
    if (!hasCharge) return { tone: 'neutral', label: L.stSopMark };
    switch (p.status) {
      case 'pending':
        return { tone: 'warn', label: L.stToSend };
      case 'sent_hr':
        return { tone: 'info', label: L.stSentHr };
      case 'deducted':
        return { tone: 'good', label: L.stDeducted };
      default:
        return { tone: 'neutral', label: L.stSopMark };
    }
  };

  const amountLabel = (amount: number | null): string => {
    if (amount === null || amount === undefined) return '—';
    if (amount === 0) return L.noCharge;
    return `฿${bahtLabel(amount)}`;
  };

  const renderPenaltyRow = (p: RecentPenalty) => {
    const meta = rowStatusMeta(p);
    const dateLabel = formatThaiDate(p.business_date ?? p.created_at);
    const hasCharge = !!p.amount && p.amount > 0;
    return (
      <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {p.penalty_code && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {p.penalty_code}
              </span>
            )}
            <span className="truncate text-sm text-gray-900 dark:text-white">{p.reason ?? '—'}</span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {p.staff_name || '—'} · {dateLabel}
          </p>
        </div>
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            hasCharge ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400',
          )}
        >
          {amountLabel(p.amount)}
        </span>
        <StatusBadge tone={meta.tone} label={meta.label} />
      </li>
    );
  };

  // ── Render guards ────────────────────────────────────────────────────────
  if (!canManage) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <Shield className="h-10 w-10 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500 dark:text-gray-400">{L.forbidden}</p>
        <Link href="/stock" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {L.back}
        </Link>
      </div>
    );
  }

  if (!currentStoreId) {
    return <EmptyState icon={ClipboardList} title={L.pickStore} description={L.pickStoreDesc} />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={L.title}
        subtitle={L.subtitle}
        actions={
          <input
            type="month"
            value={month}
            max={openBusinessDateBangkok().slice(0, 7)}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          />
        }
      />

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      ) : !summary ? (
        <EmptyState icon={Gauge} title={L.loadFail} />
      ) : (
        <>
          {/* Prominent KPI summary — 2-up on phones, 4-up on desktop. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryTile
              label={L.tileSop}
              value={`${summary.sop_points} / ${summary.threshold}`}
              sub={overThreshold ? L.overThreshold : L.underThreshold}
              tone={overThreshold ? 'rose' : 'default'}
            />
            <SummaryTile label={L.tileMoneyMonth} value={`฿${bahtLabel(moneyTotalBaht)}`} />
            <SummaryTile
              label={L.tilePendingHr}
              value={money.pending.count}
              sub={`฿${bahtLabel(money.pending.baht)}`}
              tone={money.pending.count > 0 ? 'amber' : 'default'}
            />
            <SummaryTile
              label={L.tileSentHr}
              value={money.sent_hr.count}
              sub={`฿${bahtLabel(money.sent_hr.baht)}`}
              tone={money.sent_hr.count > 0 ? 'info' : 'default'}
            />
          </div>

          {/* Summary: SOP points vs threshold with a progress bar. */}
          <Card
            className={cn(
              overThreshold && 'ring-rose-300 dark:ring-rose-800',
            )}
          >
            <CardContent>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{L.monthPoints}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    <span className={cn('tabular-nums', overThreshold && 'text-rose-600 dark:text-rose-400')}>
                      {summary.sop_points}
                    </span>{' '}
                    <span className="text-base font-medium text-gray-400">/ {summary.threshold}</span>
                  </p>
                </div>
                <StatusBadge
                  tone={overThreshold ? 'critical' : 'good'}
                  icon={overThreshold ? AlertTriangle : undefined}
                  label={overThreshold ? L.overThreshold : L.underThreshold}
                />
              </div>
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    overThreshold ? 'bg-rose-500' : 'bg-emerald-500',
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {/* Weekly A-02 occurrence chips. */}
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">{L.weeklyTitle}</p>
                {summary.week_summary.length === 0 ? (
                  <p className="text-xs text-gray-400">{L.noWeekly}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {summary.week_summary.map((w) => (
                      <span
                        key={w.week_key}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1 text-xs text-gray-700 ring-1 ring-gray-200 dark:bg-gray-700/50 dark:text-gray-200 dark:ring-gray-600"
                      >
                        <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{w.week_key}</span>
                        <span className="font-semibold tabular-nums">
                          {w.occurrences}
                          {L.times ? ` ${L.times}` : ''}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Mode toggle + actions. */}
          <Card>
            <CardHeader title={L.modeTitle} />
            <CardContent>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-gray-700">
                    {([
                      { key: true, label: L.modeAuto },
                      { key: false, label: L.modeManual },
                    ] as const).map((opt) => {
                      const active = summary.auto_hr === opt.key;
                      return (
                        <button
                          key={String(opt.key)}
                          type="button"
                          disabled={savingMode}
                          onClick={() => handleSetMode(opt.key)}
                          className={cn(
                            'rounded-md px-4 py-1.5 text-sm font-medium transition disabled:opacity-60',
                            active
                              ? 'bg-white text-indigo-700 shadow-sm dark:bg-gray-800 dark:text-indigo-300'
                              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {summary.auto_hr ? L.modeAutoHint : L.modeManualHint}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<Minus className="h-3.5 w-3.5" />}
                    onClick={() => setAdhoc({ userId: '', reason: '', amount: '' })}
                  >
                    {L.adhoc}
                  </Button>
                  <Button
                    size="sm"
                    icon={
                      sendingWarning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Megaphone className="h-3.5 w-3.5" />
                      )
                    }
                    disabled={!overThreshold || sendingWarning}
                    onClick={handleSendWarning}
                  >
                    {L.sendWarning}
                  </Button>
                </div>
              </div>

              {/* Money-deduction workflow: pending → send to HR → (HR) deducted. */}
              {money.pending.count > 0 ? (
                <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <StatusBadge tone="warn" icon={Banknote} label={L.stToSend} />
                    <span className="text-sm text-gray-700 dark:text-gray-200">
                      {L.moneyPending}: {money.pending.count} {L.items} · ฿{bahtLabel(money.pending.baht)}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    icon={
                      sendingToHr ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )
                    }
                    disabled={sendingToHr}
                    onClick={handleSendToHr}
                  >
                    {L.sendToHr}
                  </Button>
                </div>
              ) : money.sent_hr.count > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-700">
                  <StatusBadge tone="info" icon={Send} label={L.stSentHr} />
                  <span className="text-sm text-gray-700 dark:text-gray-200">
                    {L.moneySent}: {money.sent_hr.count} · ฿{bahtLabel(money.sent_hr.baht)}
                  </span>
                </div>
              ) : money.deducted.count > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-700">
                  <StatusBadge tone="good" label={L.stDeducted} />
                  <span className="text-sm text-gray-700 dark:text-gray-200">{L.moneyDeductedAll}</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Active feed — pending/sent_hr money + SOP/notify marks (deducted moved to history). */}
          <Card padding="none">
            <CardHeader title={`${L.activeTitle} (${activeRecent.length})`} />
            {activeRecent.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">{L.noRecent}</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {activeRecent.map(renderPenaltyRow)}
              </ul>
            )}
          </Card>

          {/* History — deducted fines, collapsed out of the active view. */}
          {deductedRecent.length > 0 && (
            <details className="group overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
              <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200">
                <span>
                  {L.historyTitle} ({deductedRecent.length})
                </span>
                <span className="text-xs text-gray-400 transition group-open:rotate-180">▾</span>
              </summary>
              <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-700 dark:border-gray-700">
                {deductedRecent.map(renderPenaltyRow)}
              </ul>
            </details>
          )}
        </>
      )}

      {/* Ad-hoc SV deduction modal. */}
      <Modal isOpen={!!adhoc} onClose={() => setAdhoc(null)} title={L.adhocTitle}>
        {adhoc && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{L.adhocDesc}</p>
            <Select
              label={L.employee}
              value={adhoc.userId}
              options={employeeOptions}
              onChange={(e) => setAdhoc((prev) => prev && { ...prev, userId: e.target.value })}
            />
            <Input
              label={L.reason}
              value={adhoc.reason}
              onChange={(e) => setAdhoc((prev) => prev && { ...prev, reason: e.target.value })}
            />
            <Input
              type="number"
              step="0.01"
              min="0"
              label={L.amountBaht}
              value={adhoc.amount}
              onChange={(e) => setAdhoc((prev) => prev && { ...prev, amount: e.target.value })}
            />
            <ModalFooter>
              <Button variant="outline" onClick={() => setAdhoc(null)}>
                {L.cancel}
              </Button>
              <Button onClick={handleSubmitAdhoc} isLoading={submittingAdhoc}>
                {L.save}
              </Button>
            </ModalFooter>
          </div>
        )}
      </Modal>
    </div>
  );
}
