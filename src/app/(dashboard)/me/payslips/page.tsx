'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Wallet, Printer, X, FileText } from 'lucide-react';
import { Button, EmptyState, Modal, ModalFooter, PageHeader, DataList, DataCard, MoneyValue, StatusBadge, ViewToggle, useViewMode, toast } from '@/components/ui';
import { PayslipView, type PayslipDetailData } from '@/components/hr/payslip-view';
import { PayslipFormPrint } from '@/components/hr/payslip-form-print';
import { ImportedPayslipView, periodLabel, type ImportedSlip } from '@/components/hr/imported-payslip-view';
import { TileNotices } from '../_components/tile-notices';

interface MyPayslip {
  id: string;
  gross_satang: number;
  net_satang: number;
  period_year: number | null;
  period_month: number | null;
  pay_date: string | null;
  paper_status: string | null; // requested | printed | null (④ paper-slip request)
}

const PRINT_CSS = `@media print { @page { size: 9in 5.5in; margin: 0.3in; } }`;

export default function MyPayslipsPage() {
  const t = useTranslations('hr.payslip');
  const isTh = useLocale() === 'th';
  const [rows, setRows] = useState<MyPayslip[]>([]);
  const [imported, setImported] = useState<ImportedSlip[]>([]);
  const [standing, setStanding] = useState(false);
  const [standingBusy, setStandingBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slip, setSlip] = useState<PayslipDetailData | null>(null);
  const [importedSlip, setImportedSlip] = useState<ImportedSlip | null>(null);
  const [printSlip, setPrintSlip] = useState<PayslipDetailData | null>(null);
  const [paperBusy, setPaperBusy] = useState<string | null>(null);
  const [view, setView] = useViewMode('me-payslips');

  const load = useCallback(async () => {
    try {
      const [res, impRes] = await Promise.all([
        fetch('/api/hr/ess/payslips'),
        fetch('/api/hr/ess/imported-payslips'),
      ]);
      const json = await res.json();
      setRows((json.data ?? []) as MyPayslip[]);
      setStanding(Boolean(json.paper_slip_standing));
      const impJson = await impRes.json().catch(() => ({}));
      setImported((impJson.data ?? []) as ImportedSlip[]);
    } catch {
      setRows([]);
      setImported([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = useCallback(async (id: string) => {
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
    setTimeout(() => window.print(), 50);
  }, []);

  // ④ standing "รับกระดาษทุกเดือน" preference
  const toggleStanding = useCallback(async () => {
    setStandingBusy(true);
    try {
      const res = await fetch('/api/hr/ess/paper-slip-preference', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ standing: !standing }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
      setStanding(!standing);
      toast({ type: 'success', title: !standing ? t('paperStandingOn') : t('paperStandingOff') });
    } catch (e) {
      toast({ type: 'error', title: t('loadFailed'), message: e instanceof Error ? e.message : undefined });
    } finally {
      setStandingBusy(false);
    }
  }, [standing, t]);

  // ④ per-slip paper request
  const requestPaper = useCallback(async (id: string) => {
    setPaperBusy(id);
    try {
      const res = await fetch(`/api/hr/ess/payslips/${id}/request-paper`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : undefined);
      toast({ type: 'success', title: t('paperRequested') });
      await load();
    } catch (e) {
      toast({ type: 'error', title: t('loadFailed'), message: e instanceof Error ? e.message : undefined });
    } finally {
      setPaperBusy(null);
    }
  }, [t, load]);

  const paperBadge = (s: string | null) =>
    s === 'printed' ? <StatusBadge tone="good" label={t('paperPrinted')} /> : s === 'requested' ? <StatusBadge tone="warn" label={t('paperPending')} /> : null;

  // Merge live (engine) + imported (legacy archive) slips into one timeline, newest first.
  type Merged =
    | { kind: 'live'; key: string; year: number; month: number; row: MyPayslip }
    | { kind: 'imported'; key: string; year: number; month: number; row: ImportedSlip };
  const merged = useMemo<Merged[]>(() => {
    const live: Merged[] = rows.map((r) => ({ kind: 'live', key: `l-${r.id}`, year: r.period_year ?? 0, month: r.period_month ?? 0, row: r }));
    const arch: Merged[] = imported.map((r) => ({ kind: 'imported', key: `i-${r.id}`, year: r.period_year, month: r.period_month, row: r }));
    return [...live, ...arch].sort((a, b) => b.year - a.year || b.month - a.month);
  }, [rows, imported]);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <style>{PRINT_CSS}</style>
      <div className="print:hidden">
        <PageHeader
          title={t('myTitle')}
          subtitle={t('mySubtitle')}
          className="mb-3"
          actions={<ViewToggle value={view} onChange={setView} />}
        />

        <TileNotices tile="payslips" />

        {/* ④ standing paper preference */}
        <label className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800">
          <span className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
            <FileText className="h-4 w-4 text-gray-400" /> {t('paperStanding')}
          </span>
          <button
            type="button"
            onClick={toggleStanding}
            disabled={standingBusy}
            aria-pressed={standing}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${standing ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}
          >
            {standing ? t('paperStandingOnLabel') : t('paperStandingOffLabel')}
          </button>
        </label>

        {loading ? (
          <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : merged.length === 0 ? (
          <EmptyState icon={Wallet} title={t('noPayslips')} />
        ) : (
          <DataList compact={view === 'compact'}>
            {merged.map((m) =>
              m.kind === 'live' ? (
                <DataCard
                  key={m.key}
                  onClick={() => open(m.row.id)}
                  title={`${m.row.period_month ? String(m.row.period_month).padStart(2, '0') : '—'}/${m.row.period_year ?? '—'}`}
                  subtitle={m.row.pay_date ? `${t('payDate')} ${m.row.pay_date}` : undefined}
                  status={paperBadge(m.row.paper_status)}
                  value={<MoneyValue satang={m.row.net_satang} emphasis="strong" tone="good" />}
                  actions={
                    !m.row.paper_status && !standing ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={paperBusy === m.row.id}
                        onClick={(e) => { e.stopPropagation(); requestPaper(m.row.id); }}
                      >
                        {t('paperRequest')}
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <DataCard
                  key={m.key}
                  onClick={() => setImportedSlip(m.row)}
                  title={periodLabel(m.year, m.month, isTh)}
                  subtitle={isTh ? 'ข้อมูลนำเข้า (ย้อนหลัง)' : 'Imported (historical)'}
                  status={<StatusBadge tone="neutral" label={isTh ? 'นำเข้า' : 'Archive'} />}
                  value={<MoneyValue satang={m.row.net_satang ?? 0} emphasis="strong" tone="good" />}
                />
              ),
            )}
          </DataList>
        )}
      </div>

      {slip && (
        <Modal isOpen onClose={() => setSlip(null)} title={t('title')} size="lg">
          <div className="max-h-[70vh] overflow-y-auto">
            <PayslipView data={slip} />
          </div>
          <ModalFooter>
            <Button variant="outline" onClick={() => doPrint(slip)} icon={<Printer className="h-4 w-4" />}>{t('print')}</Button>
            <Button variant="ghost" onClick={() => setSlip(null)} icon={<X className="h-4 w-4" />}>{t('close')}</Button>
          </ModalFooter>
        </Modal>
      )}

      {importedSlip && (
        <Modal isOpen onClose={() => setImportedSlip(null)} title={t('title')} size="lg">
          <div className="max-h-[70vh] overflow-y-auto">
            <ImportedPayslipView data={importedSlip} />
          </div>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setImportedSlip(null)} icon={<X className="h-4 w-4" />}>{t('close')}</Button>
          </ModalFooter>
        </Modal>
      )}

      <div className="hidden print:block">
        {printSlip && <PayslipFormPrint data={printSlip} />}
      </div>
    </div>
  );
}
