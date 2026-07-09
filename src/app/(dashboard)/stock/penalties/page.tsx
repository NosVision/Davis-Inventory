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

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  ClipboardList,
  Gauge,
  Loader2,
  Megaphone,
  Minus,
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

interface SummaryResponse {
  sop_points: number;
  threshold: number;
  auto_hr: boolean;
  week_summary: WeekOccurrence[];
  recent: RecentPenalty[];
}

interface StoreMember {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
}

function bahtLabel(amount: number): string {
  return amount.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
        statusPending: 'รอหัก',
        statusCancelled: 'ยกเลิก',
        statusRecorded: 'บันทึกแล้ว',
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
        statusPending: 'Pending',
        statusCancelled: 'Cancelled',
        statusRecorded: 'Recorded',
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
      };

  const canManage = !user || hasPermission(user, 'can_manage_stock_sop');

  const [month, setMonth] = useState<string>(() => openBusinessDateBangkok().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [members, setMembers] = useState<StoreMember[]>([]);
  const [savingMode, setSavingMode] = useState(false);
  const [sendingWarning, setSendingWarning] = useState(false);

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

  const statusMeta = (status: string | null): { tone: StatusTone; label: string } => {
    switch (status) {
      case 'pending':
        return { tone: 'warn', label: L.statusPending };
      case 'cancelled':
        return { tone: 'neutral', label: L.statusCancelled };
      default:
        return { tone: 'good', label: status ?? L.statusRecorded };
    }
  };

  const amountLabel = (amount: number | null): string => {
    if (amount === null || amount === undefined) return '—';
    if (amount === 0) return L.noCharge;
    return `฿${bahtLabel(amount)}`;
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
            </CardContent>
          </Card>

          {/* Recent penalties feed. */}
          <Card padding="none">
            <CardHeader title={L.recentTitle} />
            {summary.recent.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">{L.noRecent}</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {summary.recent.map((p) => {
                  const meta = statusMeta(p.status);
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
                          <span className="truncate text-sm text-gray-900 dark:text-white">
                            {p.reason ?? '—'}
                          </span>
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
                })}
              </ul>
            )}
          </Card>
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
