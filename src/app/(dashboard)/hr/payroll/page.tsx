'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Wallet, Lock, LockOpen, Printer, Download, X, FileText, Settings2, SlidersHorizontal, Percent, GitCompareArrows, Users, Coins, Send, Megaphone, RefreshCw, CheckCircle2, ChevronRight, ChevronDown, ArrowRight, BookOpen, StickyNote, Landmark, Banknote, type LucideIcon } from 'lucide-react';
import { Button, EmptyState, Modal, ModalFooter, PageHeader, KpiRow, StatTile, MoneyValue, StatusBadge, Skeleton, toast, useConfirm, usePromptDialog } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { formatBaht } from '@/lib/pos/money';
import { PayslipView, type PayslipDetailData } from '@/components/hr/payslip-view';
import { PayslipFormPrint } from '@/components/hr/payslip-form-print';
import { RecurringModal } from './_components/recurring-modal';
import { TaxAllowanceModal } from './_components/tax-allowance-modal';
import { AdjustmentsPanel, type AdjustmentRow, type AdjustmentsPrevious } from './_components/adjustments-panel';
import { PayrunByStore, type StoreRef } from './_components/payrun-by-store';
import { PeriodSlices, type CoverageData } from './_components/period-slices';
import { RecurringGrid } from './recurring/_components/recurring-grid';

interface CompanyOpt {
  id: string;
  name: string;
}
interface PayrunRow {
  /** null = the default (ungrouped) run. */
  payroll_group_id?: string | null;
  payroll_group?: { id: string; name: string } | null;
  id: string;
  period_year: number;
  period_month: number;
  cycle_start: string;
  cycle_end: string;
  pay_date: string | null;
  status: 'draft' | 'finalized';
  announced_at?: string | null;
  /** returned by GET /api/hr/payruns/[id]; absent from the list payload */
  store_id?: string | null;
}
interface PayslipSummary {
  id: string;
  user_id: string;
  name: string;
  employee_id?: string | null;
  pay_type: string;
  tax_mode?: string;
  worked_days?: number;
  nickname?: string | null;
  position?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  employee_code?: string | null;
  gross_satang: number;
  sso_satang: number;
  tax_satang: number;
  net_satang: number;
  total_deduction_satang: number;
  sc_net_satang: number;
  sv_deduct_satang: number;
  salary_satang?: number;
  ot_satang?: number;
  allowance_satang?: number;
  other_ded_satang?: number;
  has_tax_override?: boolean;
  remark?: string | null;
  /** Venues this person is a member of — drives the per-store reading of the register. */
  stores?: StoreRef[];
}
interface ReviewInfo {
  created_at: string;
  expires_at: string;
  accessed_at: string | null;
  saved_at: string | null;
  confirmed_at: string | null;
}
interface PoolSummary {
  total: number;
  finalized: number;
}
interface PayrunDetail {
  payrun: PayrunRow & { company_id: string; cycle_start: string; cycle_end: string; finalized_at?: string | null };
  payslips: PayslipSummary[];
  totals: {
    gross: number; net: number; sso: number; tax: number; sc_net: number; sv_deduct: number;
    salary?: number; ot?: number; allowance?: number; other_ded?: number;
  };
  review: ReviewInfo | null;
  pools?: { month: string; sc: PoolSummary; tip: PoolSummary };
  /** Employees withheld because their pay is confidential to this viewer. > 0 → totals are partial. */
  hidden_count?: number;
  /** False when the run holds someone this viewer may not see — every action on it is refused. */
  can_manage?: boolean;
}

// Print isolation: window.print() otherwise prints the whole dashboard (sidebar/header from the
// shared layout) around the slip. Hide EVERYTHING, then reveal only the payslip print root and
// pin it to the page origin — so only the 9×5.5" slip prints (owner report 2026-07-10).
const PRINT_CSS = `
@media print {
  @page { size: 9in 5.5in; margin: 0.3in; }
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  #payslip-print-root, #payslip-print-root * { visibility: visible !important; }
  #payslip-print-root { position: absolute !important; left: 0; top: 0; width: 100%; display: block !important; }
}`;

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

// 'YYYY-MM-DD' (or an ISO timestamp) → 'DD/MM/YYYY' (owner ask 2026-07-10).
function dmy(d?: string | null): string {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split('-');
  return y && m && dd ? `${dd}/${m}/${y}` : s;
}

export default function HrPayrollPage() {
  const t = useTranslations('hr.payroll');
  const isTh = useLocale() === 'th';
  // in-app replacements for window.confirm / window.prompt (finalize, reopen, announce-resend)
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { prompt, dialog: promptDialog } = usePromptDialog();

  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [month, setMonth] = useState<string>(() => currentMonth());
  const [payruns, setPayruns] = useState<PayrunRow[]>([]);
  const [detail, setDetail] = useState<PayrunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [busy, setBusy] = useState(false);
  // which payrun is currently being fetched — drives the in-chip spinner + detail skeleton
  const [openingId, setOpeningId] = useState<string | null>(null);

  const [slip, setSlip] = useState<PayslipDetailData | null>(null);
  const [printSlip, setPrintSlip] = useState<PayslipDetailData | null>(null);
  // Downloading is deliberately NOT the print path. Printing targets pre-printed security paper on
  // a dot-matrix printer and is pinned to fixed physical positions; a download is read on a screen
  // or on A4, so it gets a layout scaled to that sheet. Both render from the same slot mapping, so
  // the two documents cannot disagree about a figure.
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);
  const downloadSlipPdf = useCallback(async (d: PayslipDetailData) => {
    setPdfBusyId(d.payslip.id);
    try {
      const { buildPayslipFormPdf } = await import('@/components/hr/payslip-form-pdf');
      const blob = await buildPayslipFormPdf(d);
      const y = d.payrun?.period_year ?? '';
      const m = String(d.payrun?.period_month ?? '').padStart(2, '0');
      const who = (d.payslip.employee_code || d.payslip.employee_name || 'slip').toString().trim();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payslip-${y}-${m}-${who}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ type: 'error', title: 'สร้างไฟล์ PDF ไม่สำเร็จ' });
    } finally {
      setPdfBusyId(null);
    }
  }, []);
  const [recurringFor, setRecurringFor] = useState<{ employeeId: string; profileId: string; name: string } | null>(null);
  // company-wide item modals (one obvious spot in the hero, owner ask 2026-07-15)
  const [recurringGridOpen, setRecurringGridOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjCount, setAdjCount] = useState(0);
  // Recurring items only reach the slips at generate time — when the modal changed anything on a
  // draft payrun, recompute silently on close so ค่าเดินทาง ฯลฯ shows up without a hidden button.
  const [recurringDirty, setRecurringDirty] = useState(false);
  const [taxAllowFor, setTaxAllowFor] = useState<{ employeeId: string; name: string } | null>(null);

  // How to read the register: by person (the original) or grouped by venue. Purely a presentation
  // switch over slips already loaded — no refetch, no effect on the run.
  const [registerView, setRegisterView] = useState<'list' | 'store'>('list');

  // The period's slices — what this company owes this period and which of it exists. Loaded here
  // rather than inside the panel because generating from a card has to refresh it immediately.
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);

  // Expandable register rows: full itemized slip inline (lazy-loaded, cached per payslip id;
  // ids change on recompute so stale cache entries are simply never hit again).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedData, setExpandedData] = useState<Map<string, PayslipDetailData>>(new Map());
  const toggleExpand = useCallback(
    async (payslipId: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(payslipId)) next.delete(payslipId);
        else next.add(payslipId);
        return next;
      });
      if (!expandedData.has(payslipId)) {
        try {
          const res = await fetch(`/api/hr/payslips/${payslipId}`);
          const json = await res.json();
          if (res.ok) setExpandedData((prev) => new Map(prev).set(payslipId, json.data as PayslipDetailData));
        } catch {
          // row stays expandable; the modal path still works
        }
      }
    },
    [expandedData]
  );
  // In-place slip mutations (remark edit, tax override) keep the payslip id — refetch the cached
  // expanded view so an open row never shows a pre-edit snapshot.
  const refreshExpanded = useCallback(
    async (payslipId: string) => {
      if (!expandedData.has(payslipId)) return;
      try {
        const res = await fetch(`/api/hr/payslips/${payslipId}`);
        const json = await res.json();
        if (res.ok) setExpandedData((prev) => new Map(prev).set(payslipId, json.data as PayslipDetailData));
      } catch {
        // stale cache is refreshed on the next toggle
      }
    },
    [expandedData]
  );

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

  // NOTE: the company's payroll groups are no longer fetched here. The slice cards come from the
  // coverage endpoint, which already reports every slice of the period — group or not — together
  // with what it owes and whether its run exists. One source, so the cards and the counts on them
  // can never disagree.

  useEffect(() => {
    loadPayruns();
    setDetail(null);
  }, [loadPayruns]);

  const openPayrun = useCallback(async (id: string) => {
    setBusy(true);
    setOpeningId(id);
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
      // one-off adjustment count for the hero button badge (best-effort)
      try {
        const aRes = await fetch(`/api/hr/payruns/${id}/adjustments`);
        const aJson = (await aRes.json().catch(() => ({}))) as { data?: { adjustments?: unknown[] } };
        setAdjCount(aRes.ok ? (aJson.data?.adjustments?.length ?? 0) : 0);
      } catch {
        setAdjCount(0);
      }
    } catch {
      toast({ type: 'error', title: t('loadFailed') });
    } finally {
      setBusy(false);
      setOpeningId(null);
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

  // What this company owes this period, slice by slice. Re-read after anything that changes who
  // holds a payslip, so a card never states a count the run no longer has.
  const loadCoverage = useCallback(async () => {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return;
    setCoverageLoading(true);
    try {
      const res = await fetch(`/api/hr/payroll/coverage?year=${y}&month=${m}`);
      if (!res.ok) throw new Error('load failed');
      setCoverage((await res.json()).data as CoverageData);
    } catch {
      setCoverage(null); // a failed check must never render as "all clear"
    } finally {
      setCoverageLoading(false);
    }
  }, [month]);

  useEffect(() => {
    loadCoverage();
  }, [loadCoverage]);

  /**
   * Build (or rebuild) ONE slice of this company's period.
   *
   * The slice is passed in by the card that owns the button, never read from a separate control.
   * The old form had a group dropdown you had to set first, and pressing generate with it on the
   * wrong slice silently rebuilt the wrong run — which is how ten accounting staff ended up in no
   * July payrun at all.
   */
  const generate = useCallback(
    async (payrollGroupId: string | null) => {
      if (!companyId || !month) return;
      const [y, m] = month.split('-').map(Number);
      setGenerating(true);
      try {
        const res = await fetch('/api/hr/payruns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: companyId,
            period_year: y,
            period_month: m,
            payroll_group_id: payrollGroupId ?? undefined,
          }),
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
        // Generating also refreshes this month's draft SC pools, so the SV on these slips matches
        // the timesheet they were built from. It edits those pools — say so rather than let HR find
        // the numbers moved on their own.
        const scDone = Number(json?.data?.sc_pools_recomputed ?? 0);
        const scFailed = (json?.data?.sc_pools_failed ?? []) as string[];
        toast({
          type: 'success',
          title: t('generated', { n: json?.data?.payslips ?? 0 }),
          message: scDone > 0 ? t('generatedScRecomputed', { n: scDone }) : undefined,
        });
        if (scFailed.length > 0) {
          toast({ type: 'error', title: t('generatedScFailed', { n: scFailed.length }) });
        }
        // Not a failure — the run is valid — but these people were paid a full month because no
        // start date was on file to prorate against. Said at the moment of generating, because
        // after that the figure looks like every other one on the slip.
        const noStart = json?.data?.no_start_date as { count: number; names: string[] } | undefined;
        if (noStart && noStart.count > 0) {
          toast({
            type: 'warning',
            title: t('generatedNoStartDate', { n: noStart.count }),
            message: noStart.names.slice(0, 5).join(', ') + (noStart.count > 5 ? ' …' : ''),
          });
        }
        await Promise.all([loadCoverage(), loadPayruns()]);
        if (json?.data?.id) await openPayrun(json.data.id);
      } catch {
        toast({ type: 'error', title: t('generateFailed') });
      } finally {
        setGenerating(false);
      }
    },
    [companyId, month, t, loadCoverage, loadPayruns, openPayrun]
  );

  // Recompute the currently-open payrun for its OWN period + slice (used after saving a bonus,
  // which the engine must fold into gross → 3% tax → net; the payrun row id is stable across a
  // regenerate). `silent` skips the success toast for the post-bonus auto-recompute, which shows
  // its own.
  //
  // The slice used to be omitted from this POST, so recomputing a GROUP run rebuilt the company's
  // ungrouped run instead — the wrong run silently changed and the open one did not (fixed
  // 2026-08-18).
  const regenerateCurrent = useCallback(async (silent = false) => {
    if (!detail) return;
    const { company_id, period_year, period_month, payroll_group_id } = detail.payrun;
    setRecomputing(true);
    try {
      const res = await fetch('/api/hr/payruns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id, period_year, period_month, payroll_group_id: payroll_group_id ?? undefined }),
      });
      if (res.status === 409) { toast({ type: 'error', title: t('finalizedLocked') }); return; }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast({ type: 'error', title: t('generateFailed'), message: j?.error });
        return;
      }
      await Promise.all([loadCoverage(), loadPayruns()]);
      await openPayrun(detail.payrun.id);
      if (!silent) toast({ type: 'success', title: t('recomputed') });
    } catch {
      toast({ type: 'error', title: t('generateFailed') });
    } finally {
      setRecomputing(false);
    }
  }, [detail, loadCoverage, loadPayruns, openPayrun, t]);

  // Free-form register remark (legacy Payment file Remark column) — annotation only, so it is
  // editable on finalized runs too.
  const [remarkFor, setRemarkFor] = useState<PayslipSummary | null>(null);
  const [remarkText, setRemarkText] = useState('');
  const [remarkSaving, setRemarkSaving] = useState(false);
  const editRemark = useCallback((s: PayslipSummary) => {
    setRemarkFor(s);
    setRemarkText(s.remark ?? '');
  }, []);
  const saveRemark = useCallback(async () => {
    if (!detail || !remarkFor) return;
    setRemarkSaving(true);
    try {
      const res = await fetch(`/api/hr/payruns/${detail.payrun.id}/remarks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: remarkFor.user_id, remark: remarkText }),
      });
      if (!res.ok) {
        toast({ type: 'error', title: t('actionFailed') });
        return;
      }
      toast({ type: 'success', title: t('remarkSaved') });
      const slipId = remarkFor.id;
      setRemarkFor(null);
      await openPayrun(detail.payrun.id);
      await refreshExpanded(slipId);
    } catch {
      toast({ type: 'error', title: t('actionFailed') });
    } finally {
      setRemarkSaving(false);
    }
  }, [detail, remarkFor, remarkText, t, openPayrun, refreshExpanded]);

  const finalize = useCallback(async () => {
    if (!detail) return;
    // Forget-guard: last period had one-off adjustments and this one has none — a common miss
    // when items like กยศ recur monthly with changing amounts. Warn (never block) in the confirm.
    let warnMsg: string | undefined;
    try {
      const adjRes = await fetch(`/api/hr/payruns/${detail.payrun.id}/adjustments`);
      const adjJson = (await adjRes.json().catch(() => ({}))) as {
        data?: { adjustments?: AdjustmentRow[]; previous?: AdjustmentsPrevious | null };
      };
      const cur = adjJson.data?.adjustments?.length ?? 0;
      const prev = adjJson.data?.previous;
      if (adjRes.ok && cur === 0 && prev && prev.count > 0) {
        warnMsg = t('finalizeAdjWarn', { n: prev.count, period: `${prev.period_month}/${prev.period_year}` });
      }
    } catch {
      // guard is best-effort — a fetch failure must never stop a finalize
    }
    const ok = await confirm({
      title: t('finalizeConfirm'),
      message: warnMsg,
      tone: 'danger',
      confirmLabel: t('finalize'),
      cancelLabel: t('cancel'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      // Up to two attempts: a plain finalize, then — if the server blocks because the accountant
      // hasn't confirmed — one retry carrying HR's override reason (owner ask 2026-07-10).
      let overrideReason: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(`/api/hr/payruns/${detail.payrun.id}/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(overrideReason ? { override_reason: overrideReason } : {}),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        if (res.status === 409 && json?.code === 'accountant_not_confirmed' && attempt === 0) {
          const reason = await prompt({
            title: t('finalizeOverridePrompt'),
            required: true,
            confirmLabel: t('finalize'),
            cancelLabel: t('cancel'),
          });
          if (!reason || !reason.trim()) return; // HR cancelled the override
          overrideReason = reason.trim();
          continue;
        }
        if (!res.ok) {
          toast({ type: 'error', title: t('actionFailed'), message: typeof json?.error === 'string' ? json.error : undefined });
          return;
        }
        toast({ type: 'success', title: t('finalized') });
        await loadPayruns();
        await openPayrun(detail.payrun.id);
        return;
      }
    } finally {
      setBusy(false);
    }
  }, [detail, t, confirm, prompt, loadPayruns, openPayrun]);

  const reopen = useCallback(async () => {
    if (!detail) return;
    const reason = await prompt({
      title: t('reopenReason'),
      required: true,
      confirmLabel: t('reopen'),
      cancelLabel: t('cancel'),
    });
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
  }, [detail, t, prompt, loadPayruns, openPayrun]);

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
    if (
      resend &&
      !(await confirm({ title: t('announceResendConfirm'), confirmLabel: t('confirm'), cancelLabel: t('cancel') }))
    )
      return;
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
  }, [detail, t, confirm, openPayrun]);

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

  // Periods this company has ever run, newest first — the period stepper's shortcut list. Periods,
  // not payruns: a period holding two slices used to appear twice in the history and read as two
  // different months.
  const knownPeriods = useMemo(() => {
    const seen = new Map<string, { key: string; year: number; month: number; anyDraft: boolean }>();
    for (const p of payruns) {
      const key = `${p.period_year}-${String(p.period_month).padStart(2, '0')}`;
      const prev = seen.get(key);
      seen.set(key, {
        key,
        year: p.period_year,
        month: p.period_month,
        anyDraft: (prev?.anyDraft ?? false) || p.status === 'draft',
      });
    }
    return [...seen.values()].sort((a, b) => b.year - a.year || b.month - a.month);
  }, [payruns]);

  const stepMonth = useCallback((delta: number) => {
    setMonth((cur) => {
      const [y, m] = cur.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + delta, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });
  }, []);

  const isFinalized = detail?.payrun.status === 'finalized';
  const accountantConfirmed = !!detail?.review?.confirmed_at;
  const isAnnounced = !!detail?.payrun.announced_at;
  const hasSlips = (detail?.payslips.length ?? 0) > 0;
  // A payrun action reaches every slip in the run, so one withheld person disables all of them.
  // Saying so once, up here, beats nine buttons that each 403 only after being pressed.
  const canManageRun = detail?.can_manage !== false;
  const lockedReason = isTh
    ? 'งวดนี้มีพนักงานที่คุณไม่มีสิทธิ์ดูเงินเดือน — ต้องให้ผู้จัดการกลุ่มนี้ หรือผู้ที่ดูเงินเดือนได้ทุกคน เป็นผู้ทำ'
    : 'This run holds pay you may not see — its owner, or someone who sees all pay, must act on it';
  // skeleton only when the fetch is for a DIFFERENT payrun than the one on screen —
  // same-id refreshes (after finalize/remark/recompute) keep the current detail visible
  const openingNew = openingId !== null && openingId !== detail?.payrun.id;

  // Everything that is NOT the single context-aware primary action lives in the "เพิ่มเติม" menu.
  // Two sections: things you TAKE from a run, and things that CHANGE it. Flat, these read as
  // equally routine — and "ปิดยอด" sat next to "ดาวน์โหลด Excel" with nothing to mark it one-way.
  const GROUP_DOC = isTh ? 'เอกสาร' : 'Documents';
  const GROUP_RUN = isTh ? 'จัดการรอบจ่าย' : 'Manage run';
  const menuActions: MoreMenuAction[] = detail
    ? [
        { key: 'excel', group: GROUP_DOC, label: t('exportExcel'), icon: FileText, onClick: () => window.open(`/api/hr/payruns/${detail.payrun.id}/export`, '_blank'), disabled: !hasSlips, title: t('exportHint') },
        // Bank-transfer files (client ask 2026-07-24) — finalized runs only (the API 409s a draft):
        // one file per batch the bank wants, named Payment-<group>-<MM-YYYY>.xlsx.
        ...(isFinalized
          ? [
              { key: 'bankBbl', group: GROUP_DOC, label: t('bankFileBbl'), icon: Landmark, onClick: () => window.open(`/api/hr/payruns/${detail.payrun.id}/bank-file?group=bbl`, '_blank'), disabled: !hasSlips, title: t('bankFileHint') },
              { key: 'bankOther', group: GROUP_DOC, label: t('bankFileOther'), icon: Landmark, onClick: () => window.open(`/api/hr/payruns/${detail.payrun.id}/bank-file?group=other`, '_blank'), disabled: !hasSlips, title: t('bankFileHint') },
              { key: 'bankCash', group: GROUP_DOC, label: t('bankFileCash'), icon: Banknote, onClick: () => window.open(`/api/hr/payruns/${detail.payrun.id}/bank-file?group=cash`, '_blank'), disabled: !hasSlips, title: t('bankFileHint') },
            ]
          : []),
        { key: 'calibrate', group: GROUP_DOC, label: t('printCalibrate'), icon: Printer, onClick: () => doPrint(CALIBRATE_DATA), title: t('printCalibrateHint') },
        // ── things that change the run ──
        ...(!isFinalized
          ? [{ key: 'recompute', group: GROUP_RUN, label: t('recompute'), icon: RefreshCw, onClick: () => regenerateCurrent(), disabled: busy || recomputing, title: t('recomputeHint') }]
          : []),
        // ส่งให้บัญชี-again — only when it is not already the hero primary
        ...(isFinalized || accountantConfirmed
          ? [{ key: 'send', group: GROUP_RUN, label: t('sendToAccountant'), icon: Send, onClick: openReviewLink, disabled: busy || !hasSlips }]
          : []),
        ...(isFinalized && isAnnounced
          ? [{ key: 'announceAgain', group: GROUP_RUN, label: t('announceAgain'), icon: Megaphone, onClick: announce, disabled: busy }]
          : []),
        // finalize without accountant confirm (override flow) — red, since it locks the run
        ...(!isFinalized && !accountantConfirmed
          ? [{ key: 'finalize', group: GROUP_RUN, label: t('finalize'), icon: Lock, onClick: finalize, disabled: busy || recomputing || !hasSlips, danger: true }]
          : []),
        ...(isFinalized
          ? [{ key: 'reopen', group: GROUP_RUN, label: t('reopen'), icon: LockOpen, onClick: reopen, disabled: busy, danger: true }]
          : []),
      ]
    : [];

  const actions: MoreMenuAction[] = canManageRun
    ? menuActions
    : menuActions.map((a) =>
        // 'calibrate' prints a dummy alignment slip with nobody's figures on it.
        a.key === 'calibrate' ? a : { ...a, disabled: true, title: lockedReason }
      );

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 2xl:max-w-[96rem]">
      <style>{PRINT_CSS}</style>

      <div className="space-y-4 print:hidden">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={
            <>
              <label className="flex w-full flex-col text-xs font-medium text-gray-600 sm:w-auto dark:text-gray-400">
                {t('company')}
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="control mt-1 w-full sm:w-48">
                  {companies.length === 0 && <option value="">{t('noCompanies')}</option>}
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              {/* ONE period control for the whole page. There is no group picker and no generate
                  button here any more: both moved onto the slice cards below, where the thing being
                  built is visible. Two period controls that did not agree, plus an invisible group
                  switch, was the confusion (owner ask 2026-08-18). */}
              <label className="flex w-full flex-col text-xs font-medium text-gray-600 sm:w-auto dark:text-gray-400">
                {t('period')}
                <span className="mt-1 inline-flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => stepMonth(-1)}
                    aria-label={isTh ? 'งวดก่อนหน้า' : 'Previous period'}
                  >
                    ‹
                  </Button>
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="control w-full sm:w-auto"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => stepMonth(1)}
                    aria-label={isTh ? 'งวดถัดไป' : 'Next period'}
                  >
                    ›
                  </Button>
                </span>
              </label>
            </>
          }
        >
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/hr/payroll/compare" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              <GitCompareArrows className="h-3.5 w-3.5" /> {t('compareLink')}
            </Link>
            <Link href="/hr/payroll/flow" className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:underline dark:text-teal-400">
              <BookOpen className="h-3.5 w-3.5" /> {t('flowLink')}
            </Link>
          </div>
        </PageHeader>

        {/* Periods this company has run. Clicking one SETS the period control above — the page
            never shows one period while the control says another, which it used to do constantly. */}
        {loading ? (
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="h-9 w-24 rounded-full" />
          </div>
        ) : null}

        {knownPeriods.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {knownPeriods.map((p) => {
              const active = p.key === month;
              return (
                <button
                  key={p.key}
                  onClick={() => setMonth(p.key)}
                  aria-current={active || undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                    active
                      ? 'border-indigo-500 bg-indigo-50 font-semibold text-indigo-700 dark:border-indigo-400 dark:bg-indigo-900/30 dark:text-indigo-300'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700/50'
                  )}
                >
                  <span
                    className={cn('h-2 w-2 rounded-full', p.anyDraft ? 'bg-amber-400' : 'bg-emerald-500')}
                    title={p.anyDraft ? t('statusDraft') : t('statusFinalized')}
                  />
                  {String(p.month).padStart(2, '0')}/{p.year}
                </button>
              );
            })}
          </div>
        )}

        {/* What this company owes THIS period, slice by slice, each with the one action it needs. */}
        <PeriodSlices
          data={coverage}
          loading={coverageLoading}
          companyId={companyId}
          openPayrunId={detail?.payrun.id ?? null}
          isTh={isTh}
          busy={busy || generating || recomputing}
          onOpen={openPayrun}
          onGenerate={generate}
          onPickCompany={(id) => {
            setCompanyId(id);
            setDetail(null);
          }}
        />

        <div className="space-y-3">
          <div className="min-w-0 space-y-3">
            {/* detail */}
            {openingNew ? (
              <DetailSkeleton label={t('loadingPayrun')} />
            ) : !detail ? (
              <div className="flex min-h-[50vh] items-center justify-center rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                <EmptyState icon={Wallet} title={t('selectPayrun')} description={t('selectPayrunHint')} />
              </div>
            ) : (
              <div className="space-y-3">
                {/* status hero — period + status + stepper + ONE context-aware primary action */}
                <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                          {String(detail.payrun.period_month).padStart(2, '0')}/{detail.payrun.period_year}
                        </h2>
                        <StatusBadge
                          tone={isFinalized ? 'good' : 'warn'}
                          label={isFinalized ? t('statusFinalized') : t('statusDraft')}
                          icon={isFinalized ? Lock : undefined}
                        />
                        {isAnnounced && <StatusBadge tone="info" label={t('announcedBadge')} icon={Megaphone} />}
                      </div>
                      <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
                        {t('cycle')}: {dmy(detail.payrun.cycle_start)} → {dmy(detail.payrun.cycle_end)}
                        {detail.payrun.pay_date ? ` · ${t('payDate')} ${dmy(detail.payrun.pay_date)}` : ''}
                      </p>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                      {!isFinalized && !accountantConfirmed && (
                        <Button size="sm" icon={<Send className="h-4 w-4" />} onClick={openReviewLink} disabled={busy || !hasSlips || !canManageRun} title={canManageRun ? undefined : lockedReason}>
                          {t('nextActionSend')}
                        </Button>
                      )}
                      {!isFinalized && accountantConfirmed && (
                        <Button variant="danger" size="sm" icon={<Lock className="h-4 w-4" />} onClick={finalize} disabled={busy || recomputing || !hasSlips || !canManageRun} title={canManageRun ? undefined : lockedReason}>
                          {t('nextActionFinalize')}
                        </Button>
                      )}
                      {isFinalized && !isAnnounced && (
                        <Button size="sm" icon={<Megaphone className="h-4 w-4" />} onClick={announce} disabled={busy || !canManageRun} title={canManageRun ? undefined : lockedReason}>
                          {t('nextActionAnnounce')}
                        </Button>
                      )}
                      <MoreMenu label={t('moreActions')} actions={actions} />
                    </div>
                  </div>
                  <div className="mt-4">
                    <PayrunStepper detail={detail} />
                  </div>
                  <PoolStrip detail={detail} />
                  {/* money-item shortcuts — both open as modals from ONE obvious spot instead of a
                      header link + a panel buried under a 100-row register (owner ask 2026-07-15) */}
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
                    <Button size="sm" variant="outline" icon={<Settings2 className="h-4 w-4" />} onClick={() => setRecurringGridOpen(true)}>
                      {t('recurringGridLink')}
                    </Button>
                    <Button size="sm" variant="outline" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setAdjOpen(true)} disabled={!canManageRun} title={canManageRun ? undefined : lockedReason}>
                      {t('adjustments.title')} ({adjCount})
                    </Button>
                  </div>
                </div>

                {detail.payslips.length === 0 ? (
                  /* Every slip withheld is not an empty run. Showing "ไม่มีสลิป" here told the
                     viewer the payroll had not been built, when in fact it was built and simply
                     is not theirs to read. */
                  (detail.hidden_count ?? 0) > 0 ? (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50/70 px-3 py-3 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/15 dark:text-amber-300">
                      <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>
                        <span className="font-semibold">งวดนี้มีสลิป {detail.hidden_count} คน แต่คุณดูไม่ได้</span>{' '}
                        — {lockedReason}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                      <EmptyState icon={Wallet} title={t('noPayslips')} />
                    </div>
                  )
                ) : (
                  <div className="space-y-3">
                  {/* Some slips are withheld from this viewer, so every figure below covers only
                      what they can see. Saying so is not optional — an unlabelled partial total
                      reads as the payrun's real total. */}
                  {(detail.hidden_count ?? 0) > 0 && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/15 dark:text-amber-300">
                      <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>
                        <span className="font-semibold">
                          แสดง {detail.payslips.length} จาก {detail.payslips.length + (detail.hidden_count ?? 0)} คน
                        </span>{' '}
                        — อีก {detail.hidden_count} คนถูกปิดข้อมูลเงินเดือนไว้ ยอดรวมด้านล่างจึงเป็นยอดเฉพาะที่แสดง
                        ไม่ใช่ยอดรวมทั้งงวด · <span className="font-semibold">ปุ่มจัดการงวดนี้ถูกปิดไว้ทั้งหมด</span>{' '}
                        (Excel · ไฟล์ธนาคาร · ส่งบัญชี · ปิดยอด · ประกาศ · รายการเฉพาะงวด) เพราะทุกปุ่มทำงานกับทั้งงวด
                        ไม่ใช่เฉพาะคนที่คุณเห็น
                      </p>
                    </div>
                  )}

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

                  {/* Read the same slips by person or by venue. Presentation only — the run,
                      its totals and every action are untouched by this switch. */}
                  <div className="inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
                    {([
                      { key: 'list' as const, label: isTh ? 'รายชื่อ' : 'By person' },
                      { key: 'store' as const, label: isTh ? 'รายสาขา' : 'By venue' },
                    ]).map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setRegisterView(key)}
                        aria-pressed={registerView === key}
                        className={cn(
                          'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                          registerView === key
                            ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-700 dark:text-indigo-300'
                            : 'text-gray-500 dark:text-gray-400'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {registerView === 'store' ? (
                    <PayrunByStore
                      payslips={detail.payslips}
                      totals={{ gross: detail.totals.gross, net: detail.totals.net }}
                      isTh={isTh}
                    />
                  ) : (
                  // Capped height so the column headers pin: the register is 13 money columns wide
                  // and one row per employee deep, and scrolling past the header leaves a wall of
                  // unlabelled figures (owner ask 2026-08-17).
                  <div className="max-h-[70vh] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700">
                    <table className="w-full min-w-[64rem] text-sm">
                      <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        <tr>
                          <th className="w-8 px-2 py-2" />
                          <th className="px-3 py-2">{t('colEmployee')}</th>
                          <th className="px-2 py-2 text-right">{t('colDays')}</th>
                          <th className="px-2 py-2 text-right">{t('colSalary')}</th>
                          <th className="px-2 py-2 text-right">OT</th>
                          <th className="px-2 py-2 text-right">{t('colAllowance')}</th>
                          <th className="px-2 py-2 text-right">{t('colGross')}</th>
                          <th className="px-2 py-2 text-right">{t('colOtherDed')}</th>
                          <th className="px-2 py-2 text-right">{t('colSso')}</th>
                          <th className="px-2 py-2 text-right">{t('colTax')}</th>
                          <th className="px-2 py-2 text-right">{t('colSv')}</th>
                          <th className="px-2 py-2 text-right">{t('colNet')}</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {detail.payslips.map((s, idx) => {
                          const isOpen = expanded.has(s.id);
                          const exp = expandedData.get(s.id);
                          return (
                          <Fragment key={s.id}>
                          <tr className="bg-white dark:bg-gray-800">
                            <td className="px-2 py-2">
                              <button
                                onClick={() => toggleExpand(s.id)}
                                title={t('expandRow')}
                                aria-label={t('expandRow')}
                                className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700"
                              >
                                <ChevronRight className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90')} />
                              </button>
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => openSlip(s.id)}
                                className="text-left font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                                title={t('viewSlip')}
                              >
                                {s.name}
                                {s.nickname && s.nickname !== s.name && (
                                  <span className="ml-1 font-normal text-gray-400">({s.nickname})</span>
                                )}
                              </button>
                              <div className="text-[10px] text-gray-400">
                                {idx + 1}{s.employee_code ? ` · ${s.employee_code}` : ''}{s.position ? ` · ${s.position}` : ''}
                                {s.start_date ? ` · เริ่ม ${dmy(s.start_date)}` : ''}
                              </div>
                              {s.end_date && s.end_date <= (detail.payrun.cycle_end ?? '') && (
                                <div className="text-[10px] font-medium text-red-500">
                                  พ้นสภาพ {dmy(s.end_date)} — คำนวณตามวันทำงานจริง
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-gray-500">{s.worked_days ?? '—'}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{formatBaht(s.salary_satang ?? 0)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-gray-500">{(s.ot_satang ?? 0) > 0 ? formatBaht(s.ot_satang as number) : '—'}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-gray-500">{(s.allowance_satang ?? 0) > 0 ? formatBaht(s.allowance_satang as number) : '—'}</td>
                            <td className="px-2 py-2 text-right font-medium tabular-nums">{formatBaht(s.gross_satang)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-red-500">{(s.other_ded_satang ?? 0) > 0 ? `−${formatBaht(s.other_ded_satang as number)}` : '—'}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-gray-500">{formatBaht(s.sso_satang)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-gray-500">
                              {formatBaht(s.tax_satang)}
                              <div className="text-[9px] leading-tight text-gray-400">
                                {s.tax_mode === 'withholding_3pct' ? t('taxBadge3') : s.tax_mode === 'progressive' ? t('taxBadgeProg') : ''}
                                {s.has_tax_override ? ' ✓' : ''}
                              </div>
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {s.sc_net_satang > 0 || s.sv_deduct_satang > 0 ? (
                                <>
                                  <span className="text-violet-700 dark:text-violet-300">{formatBaht(s.sc_net_satang)}</span>
                                  {s.sv_deduct_satang > 0 && (
                                    <div className="text-[10px] text-red-500">{t('svDeducted', { amount: formatBaht(s.sv_deduct_satang) })}</div>
                                  )}
                                </>
                              ) : (
                                <span className="text-gray-300 dark:text-gray-600">—</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right font-semibold tabular-nums text-gray-900 dark:text-white">{formatBaht(s.net_satang)}</td>
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-1">
                                <button
                                  onClick={() => editRemark(s)}
                                  title={s.remark || t('remarkAdd')}
                                  aria-label={t('remarkAdd')}
                                  className={cn('rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700', s.remark ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-indigo-600 dark:text-gray-600')}
                                >
                                  <StickyNote className="h-4 w-4" />
                                </button>
                                <button onClick={() => openSlip(s.id)} title={t('viewSlip')} aria-label={t('viewSlip')} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700">
                                  <FileText className="h-4 w-4" />
                                </button>
                                {s.employee_id && (
                                  <button onClick={() => setRecurringFor({ employeeId: s.employee_id as string, profileId: s.user_id, name: s.name })} title={t('rowItems')} aria-label={t('rowItems')} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700">
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
                          {isOpen && (
                            <tr className="bg-gray-50/70 dark:bg-gray-900/30">
                              <td colSpan={13} className="px-4 py-3">
                                {exp ? (
                                  <div className="max-w-2xl">
                                    <PayslipView data={exp} />
                                  </div>
                                ) : (
                                  <div className="flex justify-center py-4 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
                                )}
                              </td>
                            </tr>
                          )}
                          </Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold dark:border-gray-600 dark:bg-gray-800/50">
                        <tr>
                          <td />
                          <td className="px-3 py-2 text-gray-900 dark:text-white">{t('totals')}</td>
                          <td />
                          <td className="px-2 py-2 text-right tabular-nums">{formatBaht(detail.totals.salary ?? 0)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-gray-500">{formatBaht(detail.totals.ot ?? 0)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-gray-500">{formatBaht(detail.totals.allowance ?? 0)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatBaht(detail.totals.gross)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-red-500">−{formatBaht(detail.totals.other_ded ?? 0)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-gray-500">{formatBaht(detail.totals.sso)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-gray-500">{formatBaht(detail.totals.tax)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-violet-700 dark:text-violet-300">{formatBaht(detail.totals.sc_net)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatBaht(detail.totals.net)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  )}

                  {/* ④ paper print queue: standing prefs + per-slip requests — collapsed by default */}
                  {printQueue.length > 0 && (
                    <details className="group rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                      <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2.5 text-sm font-semibold text-gray-800 [&::-webkit-details-marker]:hidden dark:text-gray-100">
                        <Printer className="h-4 w-4 shrink-0 text-indigo-500" />
                        <span className="min-w-0 truncate">{t('printQueueSummary', { n: printQueue.filter((q) => q.status !== 'printed').length })}</span>
                        <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="border-t border-gray-100 px-3 pb-3 dark:border-gray-700">
                      <div className="mb-1 mt-2 flex flex-wrap justify-end gap-2">
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
                    </details>
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
              <TaxOverrideBox
                slip={slip}
                onSaved={async () => {
                  await openSlip(slip.payslip.id);
                  if (detail) await openPayrun(detail.payrun.id);
                  await refreshExpanded(slip.payslip.id);
                }}
              />
            )}
            {/* OT has no field on this screen — it is derived from the timesheet (auto from punches,
                or HR's per-day override). HR asked "ไม่มีที่ให้ลง OT" because nothing pointed there. */}
            {slip.payrun?.status === 'draft' && <OtEditHint slip={slip} storeId={detail?.payrun.store_id ?? null} />}
          </div>
          <ModalFooter>
            <Button variant="outline" onClick={() => doPrint(slip)} icon={<Printer className="h-4 w-4" />}>{t('print')}</Button>
            <Button
              onClick={() => downloadSlipPdf(slip)}
              disabled={pdfBusyId === slip.payslip.id}
              icon={pdfBusyId === slip.payslip.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            >
              {t('downloadPdf')}
            </Button>
            <Button variant="ghost" onClick={() => setSlip(null)} icon={<X className="h-4 w-4" />}>{t('close')}</Button>
          </ModalFooter>
        </Modal>
      )}

      {/* per-person register remark (legacy Payment Remark column) */}
      {remarkFor && (
        <Modal isOpen onClose={() => setRemarkFor(null)} title={`${t('remarkAdd')} · ${remarkFor.name}`} size="sm">
          <div className="space-y-2">
            <textarea
              value={remarkText}
              onChange={(e) => setRemarkText(e.target.value)}
              maxLength={500}
              rows={3}
              autoFocus
              placeholder={t('remarkPlaceholder')}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
            <p className="text-xs text-gray-400">{t('remarkHint')}</p>
          </div>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setRemarkFor(null)}>{t('close')}</Button>
            <Button onClick={saveRemark} isLoading={remarkSaving}>{t('remarkSave')}</Button>
          </ModalFooter>
        </Modal>
      )}

      {recurringFor && (
        <RecurringModal
          employeeId={recurringFor.employeeId}
          name={recurringFor.name}
          payrunId={detail?.payrun.id}
          profileId={recurringFor.profileId}
          isDraft={detail?.payrun.status === 'draft'}
          onAdjustChanged={() => regenerateCurrent(true)}
          onChanged={() => setRecurringDirty(true)}
          onClose={() => {
            setRecurringFor(null);
            if (recurringDirty && detail?.payrun.status === 'draft') void regenerateCurrent(true);
            setRecurringDirty(false);
          }}
        />
      )}

      {/* company-wide recurring grid — same grid as /hr/payroll/recurring, opened in place */}
      {recurringGridOpen && (
        <Modal
          isOpen
          onClose={() => {
            setRecurringGridOpen(false);
            if (recurringDirty && detail?.payrun.status === 'draft') void regenerateCurrent(true);
            setRecurringDirty(false);
          }}
          title={t('recurringGridLink')}
          size="full"
          className="max-w-6xl"
        >
          <RecurringGrid initialCompanyId={companyId} onChanged={() => setRecurringDirty(true)} />
        </Modal>
      )}

      {/* รายการเฉพาะงวด — one-off adjustment lines, payrun-wide (supersedes the inline panel) */}
      {adjOpen && detail && (
        <Modal isOpen onClose={() => setAdjOpen(false)} title={t('adjustments.title')} size="full">
          <AdjustmentsPanel
            payrunId={detail.payrun.id}
            isDraft={detail.payrun.status === 'draft'}
            slips={detail.payslips.map((s) => ({ user_id: s.user_id, name: s.name }))}
            onChanged={() => regenerateCurrent(true)}
          />
        </Modal>
      )}

      {taxAllowFor && (
        <TaxAllowanceModal
          employeeId={taxAllowFor.employeeId}
          name={taxAllowFor.name}
          onClose={() => setTaxAllowFor(null)}
        />
      )}

      {/* floating progress pill — `recomputing` (incl. the silent post-adjustment recompute) and
          any `busy` action that is NOT already covered by the detail skeleton always get visible
          feedback, so the screen never looks frozen */}
      {(recomputing || (busy && !openingNew)) && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 print:hidden" role="status" aria-live="polite">
          <div className="flex items-center gap-2 rounded-full bg-gray-900/90 px-4 py-2 text-sm font-medium text-white shadow-lg dark:bg-gray-700/95">
            <Loader2 className="h-4 w-4 animate-spin" />
            {recomputing ? t('recomputingPill') : t('loadingPayrun')}
          </div>
        </div>
      )}

      {/* confirm/prompt dialogs (finalize, override reason, reopen reason, announce resend) */}
      {confirmDialog}
      {promptDialog}

      {/* print-only slip — fixed-position 9×5.5" security-form layout */}
      <div id="payslip-print-root" className="hidden print:block">
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

// The 4-stage status flow for a payrun (owner ask 2026-07-10): cycle ended → totals computed →
// sent to & confirmed by the accountant → finalized. Each stage is DERIVED from existing signals
// (dates, payslip count, review-link state, status) — no new DB state. The finalize gate keys off
// the same "accountant confirmed" signal shown here.
function PayrunStepper({ detail }: { detail: PayrunDetail }) {
  const t = useTranslations('hr.payroll');
  const today = new Date().toISOString().slice(0, 10);
  const cycleEnded = today >= detail.payrun.cycle_end;
  const hasSlips = detail.payslips.length > 0;
  const review = detail.review;
  const sent = !!review;
  const confirmed = !!review?.confirmed_at;
  const finalized = detail.payrun.status === 'finalized';

  const steps: { key: string; label: string; done: boolean; at: string | null; sub?: string }[] = [
    { key: 'cycle', label: t('stepCycle'), done: cycleEnded, at: detail.payrun.cycle_end, sub: cycleEnded ? undefined : t('stepCyclePending') },
    { key: 'totals', label: t('stepTotals'), done: hasSlips, at: null, sub: hasSlips ? t('stepTotalsDone', { n: detail.payslips.length }) : t('stepTotalsPending') },
    {
      key: 'accountant',
      label: t('stepAccountant'),
      done: confirmed,
      at: review?.confirmed_at ?? null,
      sub: confirmed ? t('stepAccConfirmed') : review?.saved_at ? t('stepAccSaved') : review?.accessed_at ? t('stepAccOpened') : sent ? t('stepAccSent') : t('stepAccNotSent'),
    },
    { key: 'finalized', label: t('stepFinalized'), done: finalized, at: detail.payrun.finalized_at ?? null, sub: finalized ? undefined : t('stepFinalizedPending') },
  ];
  const currentIndex = steps.findIndex((s) => !s.done);

  // bare (no own card/scroller — it lives inside the status hero): 2×2 grid on mobile so the
  // register table stays the page's only horizontal scroller, single row with chevrons on sm+
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-3 sm:flex sm:items-stretch">
        {steps.map((s, i) => {
          const state = s.done ? 'done' : i === currentIndex ? 'current' : 'pending';
          return (
            <div key={s.key} className="flex items-center sm:flex-1">
              <div className="flex flex-1 items-start gap-2">
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    state === 'done'
                      ? 'bg-emerald-500 text-white'
                      : state === 'current'
                        ? 'bg-indigo-500 text-white ring-4 ring-indigo-100 dark:ring-indigo-900/40'
                        : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                  )}
                >
                  {state === 'done' ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </span>
                <div className="min-w-0">
                  <p className={cn('text-xs font-semibold leading-tight', state === 'pending' ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-100')}>
                    {s.label}
                  </p>
                  {s.sub && <p className="text-[10px] leading-tight text-gray-500 dark:text-gray-400">{s.sub}</p>}
                  {s.done && s.at && <p className="text-[10px] leading-tight text-gray-400 dark:text-gray-500">{dmy(s.at)}</p>}
                </div>
              </div>
              {i < steps.length - 1 && (
                <ChevronRight className={cn('mx-1 hidden h-4 w-4 shrink-0 self-center sm:block', s.done ? 'text-emerald-400' : 'text-gray-300 dark:text-gray-600')} />
              )}
            </div>
          );
        })}
    </div>
  );
}

// SC + tip pool readiness for the payrun's month, with shortcuts to the allocation pages (owner
// ask 2026-07-10: keep allocation on its own pages, but surface "is it ready?" on payroll).
function PoolStrip({ detail }: { detail: PayrunDetail }) {
  const isTh = useLocale() === 'th';
  const pools = detail.pools;
  if (!pools) return null;
  // pools.month is 'YYYY-MM-01' → 'MM/YYYY'
  const [poolY, poolM] = String(pools.month).slice(0, 10).split('-');
  const poolMonthLabel = poolY && poolM ? `${poolM}/${poolY}` : String(pools.month);

  const chip = (label: string, p: PoolSummary, href: string) => {
    const state = p.total === 0 ? 'none' : p.finalized === p.total ? 'ready' : 'draft';
    const text =
      state === 'none' ? (isTh ? 'ยังไม่มี' : 'None')
      : state === 'ready' ? (isTh ? 'พร้อม' : 'Ready')
      : `${isTh ? 'ร่าง' : 'Draft'} ${p.finalized}/${p.total}`;
    const cls =
      state === 'ready' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
      : state === 'draft' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
    return (
      <Link href={href} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50">
        <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
        <span className={cn('rounded-full px-1.5 py-0.5 font-semibold', cls)}>{text}</span>
        <ArrowRight className="h-3 w-3 text-gray-400" />
      </Link>
    );
  };

  // slim line at the bottom of the status hero (no own card)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
      {/* The pools feeding THIS run are the previous month's (paid on the 15th), so the strip names
          the month instead of saying "this month" — which pointed at the wrong round. */}
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {isTh ? 'จัดสรรรอบเดือน' : 'Round of'} {poolMonthLabel}:
      </span>
      {chip('SC', pools.sc, '/hr/service-charge')}
      {chip(isTh ? 'ทิป' : 'Tip', pools.tip, '/hr/tip-pool')}
    </div>
  );
}

// Secondary-actions dropdown ("เพิ่มเติม ▾") — simple headless menu: useState + click-outside.
// Holds everything that is not the single context-aware primary action of the status hero.
interface MoreMenuAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /**
   * Section heading this action sits under. The menu mixed things you take every period (Excel,
   * bank files) with one-way actions that lock or unlock a run, in one flat list — so the two read
   * as equally routine. Grouping separates "take a copy of it" from "change its state".
   */
  group?: string;
  disabled?: boolean;
  /** destructive styling (e.g. finalize when it is not the primary action) */
  danger?: boolean;
  title?: string;
}

function MoreMenu({ label, actions }: { label: string; actions: MoreMenuAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {label}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {actions.map((a, i) => {
            // Heading printed whenever the group changes, so sections need no separate data shape.
            const newSection = a.group && a.group !== actions[i - 1]?.group;
            return (
              <div key={a.key}>
                {newSection && (
                  <p className="mt-1 border-t border-gray-100 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 first:mt-0 first:border-t-0 first:pt-1 dark:border-gray-700">
                    {a.group}
                  </p>
                )}
                <button
                  role="menuitem"
                  disabled={a.disabled}
                  title={a.title}
                  onClick={() => {
                    setOpen(false);
                    a.onClick();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50',
                    a.danger
                      ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
                      : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/50'
                  )}
                >
                  <a.icon className="h-4 w-4 shrink-0" />
                  {a.label}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Pulse-skeleton stand-in for the whole detail column while openPayrun fetches a different
// payrun — mirrors hero / KPI row / register table so the layout doesn't jump when data lands.
function DetailSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-8 w-36" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
      <div className="flex items-center justify-center gap-2 py-1 text-sm text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
      </div>
    </div>
  );
}

// (BonusBox removed 2026-07-14: superseded by the payrun-level AdjustmentsPanel — an earning
// adjustment is the new bonus, with a mandatory reason. hr_payslip_bonuses stays readable in the
// generate loop so any pre-existing bonus rows keep applying.)

// HR fallback for the accounting office's official tax figure (primary path = review link).
// Shown on draft payruns only; saving patches the slip immediately and survives regenerates.
/**
 * Points HR at the timesheet — the only place OT is entered. OT is derived per day (auto from
 * punches for ot_eligible staff, or HR's per-day override); the payslip just totals it. HR reported
 * "ไม่มีที่ให้ลง OT" because this screen has no OT field and nothing said where to go.
 * Deep-links to the slip's own cycle + employee so the right rows are already on screen.
 */
function OtEditHint({ slip, storeId }: { slip: PayslipDetailData; storeId: string | null }) {
  const isTh = useLocale() === 'th';
  const run = slip.payrun as { cycle_start?: string | null; cycle_end?: string | null } | null;
  const params = new URLSearchParams();
  if (storeId) params.set('store', storeId);
  if (run?.cycle_start) params.set('from', run.cycle_start);
  if (run?.cycle_end) params.set('to', run.cycle_end);
  if (slip.payslip.employee_name) params.set('q', slip.payslip.employee_name);

  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800/50">
      <span className="text-gray-600 dark:text-gray-400">
        {isTh ? 'OT แก้ที่ตารางเวลา ไม่ได้แก้ที่หน้านี้' : 'OT is edited on the timesheet, not here'}
      </span>
      <Link
        href={`/hr/timesheet?${params.toString()}`}
        className="ml-2 font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        {isTh ? 'ไปที่ตารางเวลา →' : 'Go to timesheet →'}
      </Link>
    </div>
  );
}

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
