'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Loader2, Wallet, Play, Lock, LockOpen, Printer, X, FileText, Settings2, Percent, GitCompareArrows, Users, Coins, Send, Megaphone, RefreshCw } from 'lucide-react';
import { Button, EmptyState, Modal, ModalFooter, PageHeader, KpiRow, StatTile, MoneyValue, StatusBadge, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { formatBaht } from '@/lib/pos/money';
import { PayslipView, type PayslipDetailData } from '@/components/hr/payslip-view';
import { PayslipFormPrint } from '@/components/hr/payslip-form-print';
import { RecurringModal } from './_components/recurring-modal';
import { TaxAllowanceModal } from './_components/tax-allowance-modal';

interface CompanyOpt {
  id: string;
  name: string;
}
interface PayrunRow {
  id: string;
  period_year: number;
  period_month: number;
  cycle_start: string;
  cycle_end: string;
  pay_date: string | null;
  status: 'draft' | 'finalized';
  announced_at?: string | null;
}
interface PayslipSummary {
  id: string;
  user_id: string;
  name: string;
  employee_id?: string | null;
  pay_type: string;
  gross_satang: number;
  sso_satang: number;
  tax_satang: number;
  net_satang: number;
}
interface PayrunDetail {
  payrun: PayrunRow & { company_id: string };
  payslips: PayslipSummary[];
  totals: { gross: number; net: number; sso: number; tax: number };
}

const PRINT_CSS = `@media print { @page { size: 9in 5.5in; margin: 0.3in; } }`;

interface PrintQueueRow {
  payslip_id: string;
  name: string;
  source: 'standing' | 'request';
  status: 'requested' | 'printed' | 'cancelled';
  printed_at: string | null;
}

// dummy slip for the alignment test print — X/9 placeholders land where real data will
const CALIBRATE_DATA: PayslipDetailData = {
  payslip: {
    id: 'calibrate', employee_name: 'XXXXXX XXXXXX', employee_code: '9999', nickname: 'XXXX',
    bank_account_no: '9999999999', rate_satang: 0, pay_type: 'full_monthly', worked_days: 99,
    gross_satang: 999999, sso_satang: 0, tax_satang: 0, total_deduction_satang: 999999, net_satang: 999999,
  },
  payrun: { period_year: 2026, period_month: 1, pay_date: null, company: { name: 'COMPANY NAME CO., LTD.', address: '99 Address line, Bangkok 10110, Thailand' } },
  earnings: [], deductions: [],
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function HrPayrollPage() {
  const t = useTranslations('hr.payroll');

  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [month, setMonth] = useState<string>(() => currentMonth());
  const [payruns, setPayruns] = useState<PayrunRow[]>([]);
  const [detail, setDetail] = useState<PayrunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [slip, setSlip] = useState<PayslipDetailData | null>(null);
  const [printSlip, setPrintSlip] = useState<PayslipDetailData | null>(null);
  const [recurringFor, setRecurringFor] = useState<{ employeeId: string; name: string } | null>(null);
  const [taxAllowFor, setTaxAllowFor] = useState<{ employeeId: string; name: string } | null>(null);

  // companies → default first
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/companies');
        const json = await res.json();
        const list = (json.data ?? []) as CompanyOpt[];
        setCompanies(list);
        setCompanyId((prev) => prev || list[0]?.id || '');
      } catch {
        setCompanies([]);
      }
    })();
  }, []);

  const loadPayruns = useCallback(async () => {
    if (!companyId) {
      setPayruns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/payruns?company_id=${companyId}`);
      const json = await res.json();
      setPayruns((json.data ?? []) as PayrunRow[]);
    } catch {
      setPayruns([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadPayruns();
    setDetail(null);
  }, [loadPayruns]);

  const openPayrun = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/payruns/${id}`);
      const json = await res.json();
      setDetail((json.data ?? null) as PayrunDetail | null);
      // ④ paper print queue (standing prefs + per-slip requests)
      try {
        const qRes = await fetch(`/api/hr/payruns/${id}/print-queue`);
        const qJson = await qRes.json().catch(() => ({}));
        setPrintQueue(qRes.ok ? ((qJson.data ?? []) as PrintQueueRow[]) : []);
        setQueueSelected(new Set());
      } catch {
        setPrintQueue([]);
      }
    } catch {
      toast({ type: 'error', title: t('loadFailed') });
    } finally {
      setBusy(false);
    }
  }, [t]);

  // ④ print queue state + batch print
  const [printQueue, setPrintQueue] = useState<PrintQueueRow[]>([]);
  const [queueSelected, setQueueSelected] = useState<Set<string>>(new Set());
  const [printBatch, setPrintBatch] = useState<PayslipDetailData[]>([]);
  const [queueBusy, setQueueBusy] = useState(false);

  const printSelected = useCallback(async () => {
    if (!detail || queueSelected.size === 0) return;
    setQueueBusy(true);
    try {
      const details = await Promise.all(
        [...queueSelected].map(async (id) => {
          const res = await fetch(`/api/hr/payslips/${id}`);
          const json = await res.json();
          if (!res.ok) throw new Error();
          return json.data as PayslipDetailData;
        })
      );
      setPrintSlip(null);
      setPrintBatch(details);
      setTimeout(() => window.print(), 80);
      // mark printed AFTER the dialog returns (print() blocks in most browsers)
      const res = await fetch(`/api/hr/payruns/${detail.payrun.id}/print-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payslip_ids: [...queueSelected] }),
      });
      if (!res.ok) throw new Error();
      toast({ type: 'success', title: t('queuePrinted', { n: queueSelected.size }) });
      await openPayrun(detail.payrun.id);
    } catch {
      toast({ type: 'error', title: t('actionFailed') });
    } finally {
      setQueueBusy(false);
    }
  }, [detail, queueSelected, t, openPayrun]);

  const generate = useCallback(async () => {
    if (!companyId || !month) return;
    const [y, m] = month.split('-').map(Number);
    setGenerating(true);
    try {
      const res = await fetch('/api/hr/payruns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, period_year: y, period_month: m }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast({ type: 'error', title: t('finalizedLocked') });
        return;
      }
      if (!res.ok) {
        toast({ type: 'error', title: t('generateFailed'), message: json?.error });
        return;
      }
      toast({ type: 'success', title: t('generated', { n: json?.data?.payslips ?? 0 }) });
      await loadPayruns();
      if (json?.data?.id) await openPayrun(json.data.id);
    } catch {
      toast({ type: 'error', title: t('generateFailed') });
    } finally {
      setGenerating(false);
    }
  }, [companyId, month, t, loadPayruns, openPayrun]);

  // Recompute the currently-open payrun for its OWN period (the manual "คำนวณใหม่" button, and
  // also used after saving a bonus, which the engine must fold into gross → 3% tax → net; the
  // payrun row id is stable across regenerate). `silent` skips the success toast for the
  // post-bonus auto-recompute (that flow shows its own "bonus saved" toast).
  const regenerateCurrent = useCallback(async (silent = false) => {
    if (!detail) return;
    const { company_id, period_year, period_month } = detail.payrun;
    setRecomputing(true);
    try {
      const res = await fetch('/api/hr/payruns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id, period_year, period_month }),
      });
      if (res.status === 409) { toast({ type: 'error', title: t('finalizedLocked') }); return; }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast({ type: 'error', title: t('generateFailed'), message: j?.error });
        return;
      }
      await loadPayruns();
      await openPayrun(detail.payrun.id);
      if (!silent) toast({ type: 'success', title: t('recomputed') });
    } catch {
      toast({ type: 'error', title: t('generateFailed') });
    } finally {
      setRecomputing(false);
    }
  }, [detail, loadPayruns, openPayrun, t]);

  const finalize = useCallback(async () => {
    if (!detail) return;
    if (!window.confirm(t('finalizeConfirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/payruns/${detail.payrun.id}/finalize`, { method: 'POST' });
      if (!res.ok) {
        toast({ type: 'error', title: t('actionFailed') });
        return;
      }
      toast({ type: 'success', title: t('finalized') });
      await loadPayruns();
      await openPayrun(detail.payrun.id);
    } finally {
      setBusy(false);
    }
  }, [detail, t, loadPayruns, openPayrun]);

  const reopen = useCallback(async () => {
    if (!detail) return;
    const reason = window.prompt(t('reopenReason'));
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/payruns/${detail.payrun.id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        toast({ type: 'error', title: t('actionFailed') });
        return;
      }
      toast({ type: 'success', title: t('reopened') });
      await loadPayruns();
      await openPayrun(detail.payrun.id);
    } finally {
      setBusy(false);
    }
  }, [detail, t, loadPayruns, openPayrun]);

  // accountant review link — mint (revokes any previous), show once, copy, revoke
  const [reviewLink, setReviewLink] = useState<{ url: string; expires_at: string; passcode: string } | null>(null);
  const [reviewStatus, setReviewStatus] = useState<{ created_at: string; accessed_at: string | null; saved_at: string | null; confirmed_at?: string | null; passcode?: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [minting, setMinting] = useState(false);
  const [reviewPasscode, setReviewPasscode] = useState('1234');

  const openReviewLink = useCallback(async () => {
    if (!detail) return;
    setReviewOpen(true);
    setReviewLink(null);
    try {
      const res = await fetch(`/api/hr/payruns/${detail.payrun.id}/review-link`);
      const json = await res.json().catch(() => ({}));
      if (res.ok) setReviewStatus(json.data ?? null);
    } catch { /* status chip stays empty */ }
    setReviewPasscode('1234');
  }, [detail]);

  const mintReviewLink = useCallback(async () => {
    if (!detail) return;
    setMinting(true);
    try {
      const res = await fetch(`/api/hr/payruns/${detail.payrun.id}/review-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: reviewPasscode.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
      setReviewLink(json.data as { url: string; expires_at: string; passcode: string });
      setReviewStatus({ created_at: new Date().toISOString(), accessed_at: null, saved_at: null, confirmed_at: null, passcode: json.data?.passcode });
    } catch (e) {
      toast({ type: 'error', title: t('actionFailed'), message: e instanceof Error ? e.message : undefined });
    } finally {
      setMinting(false);
    }
  }, [detail, t]);

  const revokeReviewLink = useCallback(async () => {
    if (!detail) return;
    try {
      const res = await fetch(`/api/hr/payruns/${detail.payrun.id}/review-link`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setReviewLink(null);
      setReviewStatus(null);
      toast({ type: 'success', title: t('reviewLinkRevoked') });
    } catch {
      toast({ type: 'error', title: t('actionFailed') });
    }
  }, [detail, t]);

  // ⑤ manual "ประกาศเงินเดือนออก" (resend needs a confirm — it blasts every phone again)
  const announce = useCallback(async () => {
    if (!detail) return;
    const resend = !!detail.payrun.announced_at;
    if (resend && !window.confirm(t('announceResendConfirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/payruns/${detail.payrun.id}/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resend }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
      toast({ type: 'success', title: t('announced', { n: json.data?.notified ?? 0 }) });
      await openPayrun(detail.payrun.id);
    } catch (e) {
      toast({ type: 'error', title: t('actionFailed'), message: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }, [detail, t, openPayrun]);

  const openSlip = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/hr/payslips/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error();
      setSlip(json.data as PayslipDetailData);
    } catch {
      toast({ type: 'error', title: t('loadFailed') });
    }
  }, [t]);

  const doPrint = useCallback((data: PayslipDetailData) => {
    setPrintSlip(data);
    // let React paint the print-only node before invoking the dialog
    setTimeout(() => window.print(), 50);
  }, []);

  const isFinalized = detail?.payrun.status === 'finalized';

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <style>{PRINT_CSS}</style>

      <div className="space-y-4 print:hidden">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={
            <>
              <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
                {t('company')}
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="control mt-1">
                  {companies.length === 0 && <option value="">{t('noCompanies')}</option>}
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
                {t('period')}
                <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="control mt-1" />
              </label>
              <Button onClick={generate} isLoading={generating} disabled={!companyId || generating} icon={<Play className="h-4 w-4" />}>
                {t('generate')}
              </Button>
            </>
          }
        >
          <Link href="/hr/payroll/compare" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            <GitCompareArrows className="h-3.5 w-3.5" /> {t('compareLink')}
          </Link>
        </PageHeader>

        {/* payrun history + detail */}
        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          {/* history */}
          <div className="space-y-1">
            <h2 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">{t('history')}</h2>
            {loading ? (
              <div className="flex justify-center py-6 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : payruns.length === 0 ? (
              <p className="text-xs text-gray-400">{t('noPayruns')}</p>
            ) : (
              <ul className="space-y-1">
                {payruns.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => openPayrun(p.id)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm',
                        detail?.payrun.id === p.id
                          ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-900/20'
                          : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50'
                      )}
                    >
                      <span className="font-medium text-gray-900 dark:text-white">
                        {String(p.period_month).padStart(2, '0')}/{p.period_year}
                      </span>
                      <StatusBadge
                        tone={p.status === 'finalized' ? 'good' : 'warn'}
                        label={p.status === 'finalized' ? t('statusFinalized') : t('statusDraft')}
                        icon={p.status === 'finalized' ? Lock : undefined}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* detail */}
          <div>
            {!detail ? (
              <EmptyState icon={Wallet} title={t('selectPayrun')} />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    {t('cycle')}: {detail.payrun.cycle_start} → {detail.payrun.cycle_end}
                    {detail.payrun.pay_date ? ` · ${t('payDate')} ${detail.payrun.pay_date}` : ''}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => doPrint(CALIBRATE_DATA)} title={t('printCalibrateHint')}>
                      {t('printCalibrate')}
                    </Button>
                    <Button variant="outline" size="sm" icon={<Send className="h-4 w-4" />} onClick={openReviewLink} disabled={busy || detail.payslips.length === 0}>
                      {t('sendToAccountant')}
                    </Button>
                    {isFinalized ? (
                      <>
                        <Button
                          variant={detail.payrun.announced_at ? 'ghost' : 'primary'}
                          size="sm"
                          icon={<Megaphone className="h-4 w-4" />}
                          onClick={announce}
                          disabled={busy}
                        >
                          {detail.payrun.announced_at ? t('announceAgain') : t('announce')}
                        </Button>
                        <Button variant="outline" size="sm" icon={<LockOpen className="h-4 w-4" />} onClick={reopen} disabled={busy}>
                          {t('reopen')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          icon={<RefreshCw className="h-4 w-4" />}
                          onClick={() => regenerateCurrent()}
                          isLoading={recomputing}
                          disabled={busy || recomputing}
                          title={t('recomputeHint')}
                        >
                          {t('recompute')}
                        </Button>
                        <Button variant="danger" size="sm" icon={<Lock className="h-4 w-4" />} onClick={finalize} disabled={busy || recomputing || detail.payslips.length === 0}>
                          {t('finalize')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {detail.payslips.length === 0 ? (
                  <EmptyState icon={Wallet} title={t('noPayslips')} />
                ) : (
                  <div className="space-y-3">
                  {/* Key figures — lead with NET as the hero; gross/deductions are secondary */}
                  <KpiRow cols={4}>
                    <StatTile label={t('colEmployee')} value={detail.payslips.length} icon={Users} />
                    <StatTile label={t('colGross')} value={<MoneyValue satang={detail.totals.gross} emphasis="kpi" />} icon={Wallet} tone="accent" />
                    <StatTile
                      label={`${t('colSso')} + ${t('colTax')}`}
                      value={<MoneyValue satang={detail.totals.sso + detail.totals.tax} emphasis="kpi" tone="muted" />}
                      icon={Percent}
                      tone="warn"
                    />
                    <StatTile label={t('colNet')} value={<MoneyValue satang={detail.totals.net} emphasis="hero" tone="good" />} icon={Coins} tone="good" />
                  </KpiRow>

                  <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                    <table className="w-full min-w-[36rem] text-sm">
                      <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                        <tr>
                          <th className="px-3 py-2">{t('colEmployee')}</th>
                          <th className="px-3 py-2 text-right">{t('colGross')}</th>
                          <th className="px-3 py-2 text-right">{t('colSso')}</th>
                          <th className="px-3 py-2 text-right">{t('colTax')}</th>
                          <th className="px-3 py-2 text-right">{t('colNet')}</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {detail.payslips.map((s) => (
                          <tr key={s.id} className="bg-white dark:bg-gray-800">
                            <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{s.name}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatBaht(s.gross_satang)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatBaht(s.sso_satang)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatBaht(s.tax_satang)}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900 dark:text-white">{formatBaht(s.net_satang)}</td>
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-1">
                                <button onClick={() => openSlip(s.id)} title={t('viewSlip')} aria-label={t('viewSlip')} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700">
                                  <FileText className="h-4 w-4" />
                                </button>
                                {s.employee_id && (
                                  <button onClick={() => setRecurringFor({ employeeId: s.employee_id as string, name: s.name })} title={t('recurring')} aria-label={t('recurring')} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700">
                                    <Settings2 className="h-4 w-4" />
                                  </button>
                                )}
                                {s.employee_id && (
                                  <button onClick={() => setTaxAllowFor({ employeeId: s.employee_id as string, name: s.name })} title="ลดหย่อนภาษี (ล.ย.01)" aria-label="ลดหย่อนภาษี (ล.ย.01)" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700">
                                    <Percent className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold dark:border-gray-600 dark:bg-gray-800/50">
                        <tr>
                          <td className="px-3 py-2 text-gray-900 dark:text-white">{t('totals')}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatBaht(detail.totals.gross)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatBaht(detail.totals.sso)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatBaht(detail.totals.tax)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatBaht(detail.totals.net)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* ④ paper print queue: standing prefs + per-slip requests */}
                  {printQueue.length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-100">
                          <Printer className="h-4 w-4 text-indigo-500" /> {t('printQueue')} ({printQueue.filter((q) => q.status !== 'printed').length})
                        </h3>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setQueueSelected(new Set(printQueue.filter((q) => q.status !== 'printed').map((q) => q.payslip_id)))}
                          >
                            {t('queueSelectAll')}
                          </Button>
                          <Button size="sm" disabled={queueSelected.size === 0 || queueBusy} isLoading={queueBusy} icon={<Printer className="h-4 w-4" />} onClick={printSelected}>
                            {t('queuePrintSelected', { n: queueSelected.size })}
                          </Button>
                        </div>
                      </div>
                      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                        {printQueue.map((q) => (
                          <li key={q.payslip_id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                            <label className="flex min-w-0 items-center gap-2">
                              <input
                                type="checkbox"
                                checked={queueSelected.has(q.payslip_id)}
                                disabled={q.status === 'printed'}
                                onChange={(e) =>
                                  setQueueSelected((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(q.payslip_id);
                                    else next.delete(q.payslip_id);
                                    return next;
                                  })
                                }
                              />
                              <span className="truncate text-gray-800 dark:text-gray-100">{q.name}</span>
                              <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                                {q.source === 'standing' ? t('queueStanding') : t('queueRequest')}
                              </span>
                            </label>
                            {q.status === 'printed' ? (
                              <StatusBadge tone="good" label={t('queuePrintedBadge')} />
                            ) : (
                              <StatusBadge tone="warn" label={t('queueWaiting')} />
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* accountant review link modal */}
      {reviewOpen && detail && (
        <Modal isOpen onClose={() => setReviewOpen(false)} title={t('sendToAccountant')} size="md">
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{t('reviewLinkHint')}</p>
          {reviewStatus && !reviewLink && (
            <div className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {t('reviewLinkExisting')} · {t('reviewLinkOpened')}: {reviewStatus.accessed_at ? new Date(reviewStatus.accessed_at).toLocaleString() : '—'} · {t('reviewLinkSaved')}: {reviewStatus.saved_at ? new Date(reviewStatus.saved_at).toLocaleString() : '—'}
              {reviewStatus.confirmed_at ? (
                <span className="ml-1 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  ✓ {t('reviewLinkConfirmed')}: {new Date(reviewStatus.confirmed_at).toLocaleString()}
                </span>
              ) : (
                <span className="ml-1 text-gray-400">· {t('reviewLinkNotConfirmed')}</span>
              )}
            </div>
          )}
          {reviewLink ? (
            (() => {
              const shareText = t('reviewLinkShareMsg', { url: reviewLink.url, code: reviewLink.passcode });
              const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(shareText)}`;
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input readOnly value={reviewLink.url} className="control w-full text-xs" onFocus={(e) => e.target.select()} />
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(reviewLink.url);
                          toast({ type: 'success', title: t('reviewLinkCopied') });
                        } catch {
                          toast({ type: 'error', title: t('actionFailed') });
                        }
                      }}
                    >
                      {t('copy')}
                    </Button>
                  </div>
                  {/* passcode display */}
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-indigo-50 px-3 py-2 dark:bg-indigo-900/20">
                    <span className="text-xs text-gray-600 dark:text-gray-300">{t('reviewLinkPasscode')}</span>
                    <span className="font-mono text-base font-bold tracking-widest text-indigo-700 dark:text-indigo-300">{reviewLink.passcode}</span>
                  </div>
                  {/* copy both + share to LINE */}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(shareText);
                          toast({ type: 'success', title: t('reviewLinkCopiedBoth') });
                        } catch {
                          toast({ type: 'error', title: t('actionFailed') });
                        }
                      }}
                    >
                      {t('reviewLinkCopyBoth')}
                    </Button>
                    <a
                      href={lineUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#06C755] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                    >
                      <Send className="h-3.5 w-3.5" /> {t('reviewLinkShareLine')}
                    </a>
                  </div>
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">{t('reviewLinkOnce', { date: new Date(reviewLink.expires_at).toLocaleDateString() })}</p>
                </div>
              );
            })()
          ) : (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                {t('reviewLinkPasscodeSet')}
                <input
                  value={reviewPasscode}
                  onChange={(e) => setReviewPasscode(e.target.value)}
                  maxLength={12}
                  className="control mt-1 w-32 font-mono tracking-widest"
                  placeholder="1234"
                />
              </label>
              <Button onClick={mintReviewLink} isLoading={minting} icon={<Send className="h-4 w-4" />}>
                {reviewStatus ? t('reviewLinkRegen') : t('reviewLinkCreate')}
              </Button>
            </div>
          )}
          <ModalFooter>
            {reviewStatus && (
              <Button variant="outline" onClick={revokeReviewLink}>{t('reviewLinkRevoke')}</Button>
            )}
            <Button variant="ghost" onClick={() => setReviewOpen(false)}>{t('close')}</Button>
          </ModalFooter>
        </Modal>
      )}

      {/* payslip detail modal */}
      {slip && (
        <Modal isOpen onClose={() => setSlip(null)} title={t('slipTitle')} size="lg">
          <div className="max-h-[70vh] overflow-y-auto">
            <PayslipView data={slip} />
            {slip.payrun?.status === 'draft' && (
              <>
                <BonusBox
                  slip={slip}
                  onSaved={async () => {
                    setSlip(null);
                    await regenerateCurrent(true); // silent — the bonus box shows its own toast
                  }}
                />
                <TaxOverrideBox
                  slip={slip}
                  onSaved={async () => {
                    await openSlip(slip.payslip.id);
                    if (detail) await openPayrun(detail.payrun.id);
                  }}
                />
              </>
            )}
          </div>
          <ModalFooter>
            <Button variant="outline" onClick={() => doPrint(slip)} icon={<Printer className="h-4 w-4" />}>{t('print')}</Button>
            <Button variant="ghost" onClick={() => setSlip(null)} icon={<X className="h-4 w-4" />}>{t('close')}</Button>
          </ModalFooter>
        </Modal>
      )}

      {recurringFor && (
        <RecurringModal
          employeeId={recurringFor.employeeId}
          name={recurringFor.name}
          onClose={() => setRecurringFor(null)}
        />
      )}

      {taxAllowFor && (
        <TaxAllowanceModal
          employeeId={taxAllowFor.employeeId}
          name={taxAllowFor.name}
          onClose={() => setTaxAllowFor(null)}
        />
      )}

      {/* print-only slip — fixed-position 9×5.5" security-form layout */}
      <div className="hidden print:block">
        {printSlip && printBatch.length === 0 && (
          <PayslipFormPrint data={printSlip} calibrate={printSlip.payslip.id === 'calibrate'} />
        )}
        {printBatch.map((d) => (
          <div key={d.payslip.id} style={{ pageBreakAfter: 'always' }}>
            <PayslipFormPrint data={d} />
          </div>
        ))}
      </div>
    </div>
  );
}

// HR one-time bonus for one employee on this payrun. Draft only; saving upserts the durable
// bonus row then regenerates so the engine folds it into gross → 3% tax → net correctly.
function BonusBox({ slip, onSaved }: { slip: PayslipDetailData; onSaved: () => Promise<void> }) {
  const t = useTranslations('hr.payroll');
  const [baht, setBaht] = useState<string>(() => (slip.bonus ? String(slip.bonus.amount_satang / 100) : ''));
  const [label, setLabel] = useState<string>(slip.bonus?.label ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = Number(baht || '0');
    if (!Number.isFinite(n) || n < 0) {
      toast({ type: 'error', title: t('bonusInvalid') });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/payslips/${slip.payslip.id}/bonus`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_satang: Math.round(n * 100), label: label.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
      toast({ type: 'success', title: t('bonusSaved') });
      await onSaved();
    } catch (e) {
      toast({ type: 'error', title: t('actionFailed'), message: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-800 dark:bg-emerald-900/10">
      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{t('bonus')}</p>
      <p className="mb-2 text-[11px] text-emerald-600/80 dark:text-emerald-400/80">{t('bonusHint')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
          {t('bonusAmount')}
          <input
            type="number"
            min="0"
            step="0.01"
            value={baht}
            onChange={(e) => setBaht(e.target.value)}
            className="control mt-0.5 block w-36"
            placeholder="0.00"
          />
        </label>
        <label className="min-w-40 flex-1 text-[11px] font-medium text-gray-600 dark:text-gray-300">
          {t('bonusLabel')}
          <input value={label} onChange={(e) => setLabel(e.target.value)} className="control mt-0.5 block w-full" />
        </label>
        <Button size="sm" onClick={save} isLoading={saving}>{t('bonusSave')}</Button>
      </div>
    </div>
  );
}

// HR fallback for the accounting office's official tax figure (primary path = review link).
// Shown on draft payruns only; saving patches the slip immediately and survives regenerates.
function TaxOverrideBox({ slip, onSaved }: { slip: PayslipDetailData; onSaved: () => Promise<void> }) {
  const t = useTranslations('hr.payroll');
  const [baht, setBaht] = useState<string>(() =>
    slip.tax_override ? String(slip.tax_override.tax_satang / 100) : ''
  );
  const [note, setNote] = useState<string>(slip.tax_override?.note ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = Number(baht);
    if (!Number.isFinite(n) || n < 0) {
      toast({ type: 'error', title: t('taxOverrideInvalid') });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/payslips/${slip.payslip.id}/tax-override`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tax_satang: Math.round(n * 100), note: note.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
      toast({ type: 'success', title: t('taxOverrideSaved') });
      await onSaved();
    } catch (e) {
      toast({ type: 'error', title: t('actionFailed'), message: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-900/10">
      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">{t('taxOverride')}</p>
      <p className="mb-2 text-[11px] text-amber-600/80 dark:text-amber-400/80">
        {slip.tax_override
          ? t('taxOverrideActive', { via: slip.tax_override.set_via === 'link' ? t('viaLink') : 'HR' })
          : t('taxOverrideHint')}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
          {t('taxOverrideAmount')}
          <input
            type="number"
            min="0"
            step="0.01"
            value={baht}
            onChange={(e) => setBaht(e.target.value)}
            className="control mt-0.5 block w-36"
            placeholder={(slip.payslip.tax_satang / 100).toFixed(2)}
          />
        </label>
        <label className="min-w-40 flex-1 text-[11px] font-medium text-gray-600 dark:text-gray-300">
          {t('taxOverrideNote')}
          <input value={note} onChange={(e) => setNote(e.target.value)} className="control mt-0.5 block w-full" />
        </label>
        <Button size="sm" onClick={save} isLoading={saving}>{t('taxOverrideSave')}</Button>
      </div>
    </div>
  );
}
