'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Loader2,
  Wallet,
  Coins,
  TrendingDown,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  RefreshCw,
  Printer,
  Lock,
  Megaphone,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  PageHeader,
  SectionHeading,
  KpiRow,
  StatTile,
  MoneyValue,
  StatusBadge,
  Modal,
  ModalFooter,
  useConfirm,
  toast,
} from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { useScLineLabel } from '@/components/hr/use-sc-line-label';
import { formatBaht, bahtToSatang } from '@/lib/pos/money';
import { svPayDate, scEventCycleForPool } from '@/lib/hr/pay-cycle';
import { ManualDeductionModal, type ManualTarget } from './_components/manual-deduction-modal';
import { ScPrintView } from './_components/sc-print-view';
import type {
  StoreOpt,
  ScData,
  ScAllocation,
  ScEmployeeInfo,
  ScRow,
  ScSourceType,
} from './_components/types';

const PRINT_CSS = `@media print { @page { margin: 1.6cm; } }`;

const SOURCE_STYLES: Record<ScSourceType, string> = {
  warning: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  warning_carry: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  leave: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  absent: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  late: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  eval: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  eval_carry: 'bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-400',
  stock_penalty: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  stock_penalty_carry: 'bg-orange-50 text-orange-600 dark:bg-orange-900/25 dark:text-orange-400',
  manual: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (same convention as the payroll register). */
function dmy(d?: string | null): string {
  if (!d) return '—';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return y && m && dd ? `${dd}/${m}/${y}` : String(d);
}

/** 'YYYY-MM-01' → 'MM/YYYY' for messages that name a period. */
function monthLabel(periodMonth: string): string {
  const [y, m] = String(periodMonth).slice(0, 10).split('-');
  return y && m ? `${m}/${y}` : String(periodMonth);
}

/** Current calendar month as YYYY-MM (Bangkok clock is close enough for a month picker). */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function HrServiceChargePage() {
  const t = useTranslations('hr.serviceCharge');
  // auto lines carry an English label written at recompute time — localize on render
  const scLineLabel = useScLineLabel();
  const { confirm, dialog } = useConfirm();

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [month, setMonth] = useState<string>(() => currentMonth());

  const [employees, setEmployees] = useState<ScEmployeeInfo[]>([]);
  const [data, setData] = useState<ScData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // pool form
  const [poolTotalBaht, setPoolTotalBaht] = useState('');
  const [notes, setNotes] = useState('');
  const [savingPool, setSavingPool] = useState(false);

  // allocation edits (baht strings keyed by user_id)
  const [allocInputs, setAllocInputs] = useState<Record<string, string>>({});
  const [savingAlloc, setSavingAlloc] = useState(false);

  const [recomputing, setRecomputing] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [manualTarget, setManualTarget] = useState<ManualTarget | null>(null);

  const periodMonth = `${month}-01`;
  const pool = data?.pool ?? null;
  const isFinalized = pool?.status === 'finalized';
  const storeName = stores.find((s) => s.id === storeId)?.store_name ?? '';

  // manageable stores → default to first
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/manageable-stores');
        const json = await res.json();
        const list = (json.data ?? []) as StoreOpt[];
        setStores(list);
        setStoreId((prev) => prev || list[0]?.id || '');
      } catch {
        setStores([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!storeId || !month) {
      setData(null);
      setEmployees([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const [scRes, empRes] = await Promise.all([
        fetch(`/api/hr/service-charge?store_id=${storeId}&period_month=${month}-01`),
        fetch(`/api/hr/employees?store_id=${storeId}`),
      ]);
      if (!scRes.ok || !empRes.ok) throw new Error('load failed');
      const scJson = await scRes.json();
      const empJson = await empRes.json();
      setData((scJson.data ?? null) as ScData | null);
      // Keep the payroll identity next to the app account: full name + position + start date
      // come from hr_employees, the nickname from the linked profile.
      const emps = (empJson.data ?? []) as {
        full_name: string | null;
        start_date: string | null;
        position: { name: string | null } | null;
        profile: { id: string; display_name: string | null; username: string | null } | null;
      }[];
      setEmployees(
        emps
          .filter((e) => !!e.profile)
          .map((e) => ({
            id: e.profile!.id,
            nickname: e.profile!.display_name || e.profile!.username || null,
            fullName: e.full_name?.trim() || null,
            position: e.position?.name ?? null,
            startDate: e.start_date ?? null,
          }))
      );
    } catch {
      setError(true);
      setData(null);
      setEmployees([]);
      toast({ type: 'error', title: t('loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [storeId, month, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Merge employees (canonical row set) with existing allocations. Any allocation for a
  // user no longer returned by /employees (e.g. transferred out) is still appended so their
  // finalized pay is never hidden.
  const rows: ScRow[] = useMemo(() => {
    const allocByUser = new Map<string, ScAllocation>();
    data?.allocations.forEach((a) => allocByUser.set(a.user_id, a));
    const seen = new Set<string>();
    const out: ScRow[] = [];
    employees.forEach((e) => {
      seen.add(e.id);
      out.push({
        userId: e.id,
        name: e.fullName || e.nickname || '—',
        nickname: e.nickname,
        position: e.position,
        startDate: e.startDate,
        allocation: allocByUser.get(e.id) ?? null,
      });
    });
    data?.allocations.forEach((a) => {
      if (seen.has(a.user_id)) return;
      out.push({
        userId: a.user_id,
        name: a.employee?.display_name || a.employee?.username || '—',
        nickname: a.employee?.display_name || a.employee?.username || null,
        position: null,
        startDate: null,
        allocation: a,
      });
    });
    return out;
  }, [employees, data]);

  // Seed pool form + allocation inputs whenever the loaded data changes.
  useEffect(() => {
    setPoolTotalBaht(pool ? String(pool.total_satang / 100) : '');
    setNotes(pool?.notes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    const next: Record<string, string> = {};
    rows.forEach((r) => {
      const s = r.allocation?.allocated_satang ?? 0;
      next[r.userId] = s ? String(s / 100) : '';
    });
    setAllocInputs(next);
  }, [rows]);

  const savePool = async () => {
    const amt = Number(poolTotalBaht);
    if (!Number.isFinite(amt) || amt < 0) {
      toast({ type: 'warning', title: t('poolTotalInvalid') });
      return;
    }
    setSavingPool(true);
    try {
      const res = await fetch('/api/hr/service-charge', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          period_month: periodMonth,
          total_satang: bahtToSatang(amt),
          notes: notes.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 409) {
        toast({ type: 'error', title: t('finalizedLocked') });
        return;
      }
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed'), message: json?.error });
        return;
      }
      toast({ type: 'success', title: t('poolSaved') });
      await load();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    } finally {
      setSavingPool(false);
    }
  };

  const saveAllocations = async () => {
    if (!pool) {
      toast({ type: 'warning', title: t('savePoolFirst') });
      return;
    }
    setSavingAlloc(true);
    try {
      const allocations = rows.map((r) => ({
        user_id: r.userId,
        allocated_satang: bahtToSatang(Number(allocInputs[r.userId] || 0)),
      }));
      const res = await fetch(`/api/hr/service-charge/${pool.id}/allocations`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allocations }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed'), message: json?.error });
        return;
      }
      toast({ type: 'success', title: t('allocationsSaved') });
      await load();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    } finally {
      setSavingAlloc(false);
    }
  };

  const recompute = async () => {
    if (!pool) return;
    setRecomputing(true);
    try {
      const res = await fetch(`/api/hr/service-charge/${pool.id}/recompute`, { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as { data?: ScData; error?: string };
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed'), message: json?.error });
        return;
      }
      setData((json.data ?? null) as ScData | null);
      toast({ type: 'success', title: t('recomputed') });
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    } finally {
      setRecomputing(false);
    }
  };

  const deleteDeduction = async (id: string) => {
    try {
      const res = await fetch(`/api/hr/service-charge/deductions/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed') });
        return;
      }
      toast({ type: 'success', title: t('deductionDeleted') });
      await load();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    }
  };

  const finalize = async () => {
    if (!pool) return;
    if (!(await confirm({ title: t('finalizeConfirm'), tone: 'danger', confirmLabel: t('finalize') }))) return;
    setFinalizing(true);
    try {
      const res = await fetch(`/api/hr/service-charge/${pool.id}/finalize`, { method: 'POST' });
      if (res.status === 409) {
        toast({ type: 'error', title: t('finalizedLocked') });
        return;
      }
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed') });
        return;
      }
      toast({ type: 'success', title: t('finalized') });
      await load();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    } finally {
      setFinalizing(false);
    }
  };

  // "ประกาศ SV" — manual send with an editable message template (owner ask 2026-07-15).
  const [annOpen, setAnnOpen] = useState(false);
  const [annMessage, setAnnMessage] = useState('');
  const [annDefault, setAnnDefault] = useState('');
  const [annSaving, setAnnSaving] = useState(false);
  const [annSending, setAnnSending] = useState(false);

  const openAnnounce = async () => {
    if (!pool) return;
    try {
      const res = await fetch(`/api/hr/service-charge/${pool.id}/announce`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error();
      const d = (json.data ?? {}) as { message?: string | null; default_message?: string };
      setAnnDefault(d.default_message ?? '');
      setAnnMessage(d.message ?? d.default_message ?? '');
      setAnnOpen(true);
    } catch {
      toast({ type: 'error', title: t('loadFailed') });
    }
  };

  const saveAnnounceMessage = async () => {
    if (!pool) return;
    setAnnSaving(true);
    try {
      const res = await fetch(`/api/hr/service-charge/${pool.id}/announce`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: annMessage }),
      });
      if (!res.ok) throw new Error();
      toast({ type: 'success', title: t('announceMsgSaved') });
      await load();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    } finally {
      setAnnSaving(false);
    }
  };

  const resetAnnounceMessage = async () => {
    if (!pool) return;
    setAnnSaving(true);
    try {
      const res = await fetch(`/api/hr/service-charge/${pool.id}/announce`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setAnnMessage(annDefault);
      toast({ type: 'success', title: t('announceMsgReset') });
      await load();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    } finally {
      setAnnSaving(false);
    }
  };

  const sendAnnounce = async () => {
    if (!pool) return;
    const resend = !!pool.announced_at;
    if (resend && !(await confirm({ title: t('announceResendConfirm'), confirmLabel: t('announceSend') }))) return;
    setAnnSending(true);
    try {
      // save the (possibly edited) message first so what is sent is what is on screen
      await fetch(`/api/hr/service-charge/${pool.id}/announce`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: annMessage }),
      });
      const res = await fetch(`/api/hr/service-charge/${pool.id}/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resend }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ type: 'error', title: typeof json.error === 'string' ? json.error : t('saveFailed') });
        return;
      }
      toast({ type: 'success', title: t('announced', { n: json.data?.notified ?? 0 }) });
      setAnnOpen(false);
      await load();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    } finally {
      setAnnSending(false);
    }
  };

  const toggleRow = (userId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const SOURCE_LABEL_KEY: Record<ScSourceType, string> = {
    warning: 'srcWarning',
    warning_carry: 'srcWarningCarry',
    leave: 'srcLeave',
    absent: 'srcAbsent',
    late: 'srcLate',
    eval: 'srcEval',
    eval_carry: 'srcEvalCarry',
    stock_penalty: 'srcStockPenalty',
    stock_penalty_carry: 'srcStockPenaltyCarry',
    manual: 'srcManual',
  };
  const sourceLabel = (s: ScSourceType) => t(SOURCE_LABEL_KEY[s] ?? 'srcManual');

  // A pool is allocated at the start of its month and transferred on the 15th of that SAME month.
  // svPayDate is the single definition of that, shared with the tip page and the payslip so the
  // three surfaces cannot disagree about when a pool lands — which is exactly how this page once
  // taught HR the wrong month (2026-08-19).
  const payDateDisplay = pool?.pay_date ?? svPayDate(month);
  // The window the automatic deductions are read from — the PAYROLL CYCLE before the pool pays, so
  // a dock can never land on money already transferred and the figures line up with the payroll
  // file HR reconciles against. Spelled out as dates: a relative phrase, or a bare month against a
  // 26th–25th cycle, is what let the two spans be confused to begin with.
  const deductCycle = scEventCycleForPool(pool?.period_month ?? `${month}-01`);
  const deductWindowLabel = `${dmy(deductCycle.start)} – ${dmy(deductCycle.end)}`;
  const busy = savingPool || savingAlloc || recomputing || finalizing;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <style>{PRINT_CSS}</style>

      {/* ── On-screen (hidden while printing) ───────────────────────── */}
      <div className="space-y-4 print:hidden">
        {/* header + filters */}
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={
            <>
              <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
                {t('filterStore')}
                <select
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  className="control mt-1"
                >
                  {stores.length === 0 && <option value="">{t('noStores')}</option>}
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.store_name}
                    </option>
                  ))}
                </select>
              </label>
              {/* Say which month this picker means. On a pay screen "เดือน" is ambiguous on its
                  own, so both halves of the rule are spelled out under it with real dates: the
                  pool pays on the 15th of the month picked, and it is docked by what happened the
                  month before. Two short lines, not one run-on — this caption is read at a glance
                  while choosing a month. */}
              <label className="flex max-w-[14rem] flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
                {t('filterMonth')}
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="control mt-1"
                />
                <span className="mt-1.5 font-normal leading-snug tabular-nums text-gray-600 dark:text-gray-300">
                  {t('payTransferOn', { payDate: dmy(payDateDisplay) })}
                </span>
                <span className="text-[11px] font-normal leading-snug tabular-nums text-gray-400 dark:text-gray-500">
                  {t('deductWindowOn', { month: deductWindowLabel })}
                </span>
              </label>
            </>
          }
        />

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : stores.length === 0 ? (
          <EmptyState icon={Wallet} title={t('noStores')} />
        ) : error ? (
          <EmptyState icon={Wallet} title={t('loadFailed')} />
        ) : (
          <>
            {/* ── Pool section ─────────────────────────────────────── */}
            <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    {t('poolTotalLabel')}
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.01}
                      value={poolTotalBaht}
                      disabled={isFinalized}
                      onChange={(e) => setPoolTotalBaht(e.target.value)}
                      placeholder="0.00"
                      className={cn('control w-40', isFinalized && 'opacity-60')}
                    />
                    <span className="text-sm text-gray-500 dark:text-gray-400">฿</span>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    {t('payDateLabel')}
                  </label>
                  <input
                    type="date"
                    value={payDateDisplay}
                    readOnly
                    className={cn('control w-40 cursor-default opacity-70')}
                  />
                </div>

                <div className="min-w-[12rem] flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    {t('notesLabel')}
                  </label>
                  <input
                    type="text"
                    value={notes}
                    disabled={isFinalized}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t('notesPlaceholder')}
                    className={cn('control w-full', isFinalized && 'opacity-60')}
                  />
                </div>

                <div className="flex items-center gap-2 self-end pb-0.5">
                  <StatusBadge
                    tone={isFinalized ? 'good' : 'warn'}
                    label={isFinalized ? t('statusFinalized') : t('statusDraft')}
                    icon={isFinalized ? Lock : undefined}
                  />
                  {!isFinalized && (
                    <Button onClick={savePool} isLoading={savingPool} disabled={busy} type="button">
                      {pool ? t('savePool') : t('createPool')}
                    </Button>
                  )}
                </div>
              </div>
            </section>

            {/* An evaluation is closed around the 10th and docks the pool transferred on the 15th, so
                THIS pool is fed by the PREVIOUS month's evaluation. Finalize before that period is
                closed and its result can never reach anyone's pay — the pool locks and the scoring
                affects nothing. There was no sign of that on this page (client ask 2026-08-20). */}
            {data?.evaluation && data.evaluation.state !== 'closed' && !isFinalized && (
              <p className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                {t(data.evaluation.state === 'missing' ? 'evalMissing' : 'evalNotClosed', {
                  month: monthLabel(data.evaluation.period_month),
                })}
              </p>
            )}

            {/* ── Key totals — lead with NET as the hero ───────────── */}
            {data && (
              <KpiRow cols={3}>
                <StatTile
                  label={t('colAllocated')}
                  value={<MoneyValue satang={data.totals.allocated} emphasis="kpi" />}
                  icon={Wallet}
                  tone="accent"
                />
                <StatTile
                  label={t('colDeductions')}
                  value={<MoneyValue satang={-data.totals.deducted} emphasis="kpi" signed />}
                  icon={TrendingDown}
                  tone="critical"
                />
                <StatTile
                  label={t('colNet')}
                  value={<MoneyValue satang={data.totals.net} emphasis="hero" tone="good" />}
                  icon={Coins}
                  tone="good"
                />
              </KpiRow>
            )}

            {/* ── Allocation actions ───────────────────────────────── */}
            <SectionHeading
              title={t('allocationsTitle')}
              extra={
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    icon={<RefreshCw className="h-4 w-4" />}
                    onClick={recompute}
                    isLoading={recomputing}
                    disabled={!pool || busy}
                  >
                    {t('recompute')}
                  </Button>
                  {!isFinalized && (
                    <Button
                      size="sm"
                      type="button"
                      onClick={saveAllocations}
                      isLoading={savingAlloc}
                      disabled={!pool || busy}
                    >
                      {t('saveAllocations')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    icon={<Printer className="h-4 w-4" />}
                    onClick={() => window.print()}
                    disabled={!data}
                  >
                    {t('print')}
                  </Button>
                  {!isFinalized && (
                    <Button
                      variant="danger"
                      size="sm"
                      type="button"
                      icon={<Lock className="h-4 w-4" />}
                      onClick={finalize}
                      isLoading={finalizing}
                      disabled={!pool || busy}
                    >
                      {t('finalize')}
                    </Button>
                  )}
                  {isFinalized && (
                    <Button
                      size="sm"
                      type="button"
                      icon={<Megaphone className="h-4 w-4" />}
                      onClick={openAnnounce}
                      disabled={busy}
                    >
                      {pool?.announced_at ? t('announceAgain') : t('announce')}
                    </Button>
                  )}
                </div>
              }
            />

            {rows.length === 0 ? (
              <EmptyState icon={Wallet} title={t('noEmployees')} />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2">{t('colEmployee')}</th>
                      <th className="px-3 py-2 text-right">{t('colAllocated')}</th>
                      <th className="px-3 py-2 text-right">{t('colDeductions')}</th>
                      <th className="px-3 py-2 text-right">{t('colNet')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map((r) => {
                      const a = r.allocation;
                      const isOpen = expanded.has(r.userId);
                      const deducted = a
                        ? a.deductions.reduce((s, d) => s + Math.max(0, d.amount_satang), 0)
                        : 0;
                      const editedSatang = bahtToSatang(Number(allocInputs[r.userId] || 0));
                      const net = a ? a.net_satang : editedSatang;
                      return (
                        <Fragment key={r.userId}>
                          <tr className="bg-white dark:bg-gray-800">
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => toggleRow(r.userId)}
                                className="inline-flex items-center gap-1.5 text-left font-medium text-gray-900 dark:text-white"
                              >
                                {isOpen ? (
                                  <ChevronDown className="h-4 w-4 text-gray-400" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-gray-400" />
                                )}
                                <span>
                                  {r.name}
                                  {r.nickname && r.nickname !== r.name && (
                                    <span className="ml-1 font-normal text-gray-400">({r.nickname})</span>
                                  )}
                                </span>
                              </button>
                              {(r.position || r.startDate) && (
                                <div className="pl-[22px] text-[10px] text-gray-400">
                                  {[r.position, r.startDate ? `เริ่ม ${dmy(r.startDate)}` : null]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step={0.01}
                                  value={allocInputs[r.userId] ?? ''}
                                  disabled={isFinalized}
                                  onChange={(e) =>
                                    setAllocInputs((prev) => ({
                                      ...prev,
                                      [r.userId]: e.target.value,
                                    }))
                                  }
                                  placeholder="0.00"
                                  className={cn('control w-28 text-right', isFinalized && 'opacity-60')}
                                />
                                <span className="text-xs text-gray-400">฿</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">
                              {deducted > 0 ? (
                                <span className="text-red-600 dark:text-red-400">
                                  −{formatBaht(deducted)} ฿
                                </span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-white">
                              {formatBaht(net)} ฿
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-gray-50 dark:bg-gray-800/40">
                              <td colSpan={4} className="px-3 py-3">
                                {a && a.deductions.length > 0 ? (
                                  <ul className="space-y-1.5">
                                    {a.deductions.map((d) => (
                                      <li
                                        key={d.id}
                                        className="flex flex-wrap items-center gap-2 text-xs"
                                      >
                                        <span
                                          className={cn(
                                            'inline-flex items-center rounded-full px-1.5 py-0.5 font-medium',
                                            SOURCE_STYLES[d.source_type]
                                          )}
                                        >
                                          {sourceLabel(d.source_type)}
                                        </span>
                                        <span className="text-gray-700 dark:text-gray-200">
                                          {scLineLabel(d, { detailOnly: true })}
                                        </span>
                                        <span className="font-medium text-red-600 dark:text-red-400">
                                          −{formatBaht(d.amount_satang)} ฿
                                        </span>
                                        {d.carry_satang > 0 && (
                                          <span className="text-amber-600 dark:text-amber-400">
                                            {t('carryLabel')} {formatBaht(d.carry_satang)} ฿
                                          </span>
                                        )}
                                        {d.note && (
                                          <span className="text-gray-400">· {d.note}</span>
                                        )}
                                        {!d.auto && !isFinalized && (
                                          <button
                                            type="button"
                                            onClick={() => deleteDeduction(d.id)}
                                            aria-label={t('deleteDeduction')}
                                            title={t('deleteDeduction')}
                                            className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                                          >
                                            <X className="h-3.5 w-3.5" />
                                          </button>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-xs text-gray-400">{t('noDeductions')}</p>
                                )}
                                {a && !isFinalized && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    type="button"
                                    icon={<Plus className="h-3.5 w-3.5" />}
                                    onClick={() =>
                                      setManualTarget({ allocId: a.id, name: r.name })
                                    }
                                    className="mt-2"
                                  >
                                    {t('addManualDeduction')}
                                  </Button>
                                )}
                                {!a && (
                                  <p className="mt-1 text-xs text-gray-400">
                                    {t('saveAllocationsHint')}
                                  </p>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  {data && (
                    <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold dark:border-gray-600 dark:bg-gray-800/50">
                      <tr>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">
                          {t('totalsLabel')}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                          {formatBaht(data.totals.allocated)} ฿
                        </td>
                        <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">
                          −{formatBaht(data.totals.deducted)} ฿
                        </td>
                        <td className="px-3 py-2 text-right text-gray-900 dark:text-white">
                          {formatBaht(data.totals.net)} ฿
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Print-only summary ──────────────────────────────────────── */}
      <div className="hidden print:block">
        {data && (
          <ScPrintView data={data} rows={rows} storeName={storeName} periodMonth={month} />
        )}
      </div>

      <ManualDeductionModal
        target={manualTarget}
        onClose={() => setManualTarget(null)}
        onAdded={() => {
          setManualTarget(null);
          load();
        }}
      />

      {/* ประกาศ SV — editable template, sent manually (never auto on finalize) */}
      {annOpen && pool && (
        <Modal isOpen onClose={() => !annSending && setAnnOpen(false)} title={t('announceTitle')} size="md">
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('announceHint', { n: rows.filter((r) => (r.allocation?.allocated_satang ?? 0) > 0).length, payDate: payDateDisplay })}
            </p>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
              {t('announceMsgLabel')}
              <textarea
                value={annMessage}
                onChange={(e) => setAnnMessage(e.target.value)}
                rows={4}
                maxLength={500}
                className="control mt-1 w-full"
              />
            </label>
            <p className="text-[11px] text-gray-400">{t('announceVarsHint')}</p>
            {pool.announced_at && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {t('announceLastSent', { at: new Date(pool.announced_at).toLocaleString('th-TH') })}
              </p>
            )}
          </div>
          <ModalFooter>
            <Button variant="ghost" size="sm" onClick={resetAnnounceMessage} disabled={annSaving || annSending}>
              {t('announceReset')}
            </Button>
            <Button variant="outline" size="sm" onClick={saveAnnounceMessage} isLoading={annSaving} disabled={annSending}>
              {t('announceSaveMsg')}
            </Button>
            <Button size="sm" icon={<Megaphone className="h-4 w-4" />} onClick={sendAnnounce} isLoading={annSending} disabled={annSaving}>
              {t('announceSend')}
            </Button>
          </ModalFooter>
        </Modal>
      )}
      {dialog}
    </div>
  );
}
