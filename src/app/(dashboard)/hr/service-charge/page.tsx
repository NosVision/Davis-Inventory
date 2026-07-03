'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Loader2,
  Wallet,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  RefreshCw,
  Printer,
  Lock,
} from 'lucide-react';
import { Button, Badge, EmptyState, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { formatBaht, bahtToSatang } from '@/lib/pos/money';
import { ManualDeductionModal, type ManualTarget } from './_components/manual-deduction-modal';
import { ScPrintView } from './_components/sc-print-view';
import type {
  StoreOpt,
  ScData,
  ScAllocation,
  ScEmployeeRef,
  ScRow,
  ScSourceType,
} from './_components/types';

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

const PRINT_CSS = `@media print { @page { margin: 1.6cm; } }`;

const SOURCE_STYLES: Record<ScSourceType, string> = {
  warning: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  leave: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  late: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  eval: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  manual: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

/** Current calendar month as YYYY-MM (Bangkok clock is close enough for a month picker). */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function HrServiceChargePage() {
  const t = useTranslations('hr.serviceCharge');

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [month, setMonth] = useState<string>(() => currentMonth());

  const [employees, setEmployees] = useState<ScEmployeeRef[]>([]);
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
      const emps = (empJson.data ?? []) as { profile: ScEmployeeRef | null }[];
      setEmployees(emps.map((e) => e.profile).filter((p): p is ScEmployeeRef => !!p));
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
        name: e.display_name || e.username || '—',
        allocation: allocByUser.get(e.id) ?? null,
      });
    });
    data?.allocations.forEach((a) => {
      if (seen.has(a.user_id)) return;
      out.push({
        userId: a.user_id,
        name: a.employee?.display_name || a.employee?.username || '—',
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
    if (!window.confirm(t('finalizeConfirm'))) return;
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

  const toggleRow = (userId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const sourceLabel = (s: ScSourceType) =>
    s === 'warning'
      ? t('srcWarning')
      : s === 'leave'
        ? t('srcLeave')
        : s === 'late'
          ? t('srcLate')
          : s === 'eval'
            ? t('srcEval')
            : t('srcManual');

  const payDateDisplay = pool?.pay_date ?? `${month}-15`;
  const busy = savingPool || savingAlloc || recomputing || finalizing;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <style>{PRINT_CSS}</style>

      {/* ── On-screen (hidden while printing) ───────────────────────── */}
      <div className="space-y-4 print:hidden">
        {/* header + filters */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
              {t('filterStore')}
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className={cn('mt-1', inputCls)}
              >
                {stores.length === 0 && <option value="">{t('noStores')}</option>}
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.store_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
              {t('filterMonth')}
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className={cn('mt-1', inputCls)}
              />
            </label>
          </div>
        </div>

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
                      className={cn('w-40', inputCls, isFinalized && 'opacity-60')}
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
                    className={cn('w-40 cursor-default opacity-70', inputCls)}
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
                    className={cn('w-full', inputCls, isFinalized && 'opacity-60')}
                  />
                </div>

                <div className="flex items-center gap-2 self-end pb-0.5">
                  <Badge variant={isFinalized ? 'success' : 'warning'}>
                    {isFinalized ? t('statusFinalized') : t('statusDraft')}
                  </Badge>
                  {!isFinalized && (
                    <Button onClick={savePool} isLoading={savingPool} disabled={busy} type="button">
                      {pool ? t('savePool') : t('createPool')}
                    </Button>
                  )}
                </div>
              </div>
            </section>

            {/* ── Allocation actions ───────────────────────────────── */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {t('allocationsTitle')}
              </h2>
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
              </div>
            </div>

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
                                {r.name}
                              </button>
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
                                  className={cn(
                                    'w-28 text-right',
                                    inputCls,
                                    isFinalized && 'opacity-60'
                                  )}
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
                                          {d.label}
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
    </div>
  );
}
