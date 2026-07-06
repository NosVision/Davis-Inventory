'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Wallet, Printer, X, FileText } from 'lucide-react';
import { Button, EmptyState, Modal, ModalFooter, PageHeader, DataList, DataCard, MoneyValue, StatusBadge, ViewToggle, useViewMode, toast } from '@/components/ui';
import { PayslipView, type PayslipDetailData } from '@/components/hr/payslip-view';
import { PayslipFormPrint } from '@/components/hr/payslip-form-print';

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
  const [rows, setRows] = useState<MyPayslip[]>([]);
  const [standing, setStanding] = useState(false);
  const [standingBusy, setStandingBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slip, setSlip] = useState<PayslipDetailData | null>(null);
  const [printSlip, setPrintSlip] = useState<PayslipDetailData | null>(null);
  const [paperBusy, setPaperBusy] = useState<string | null>(null);
  const [view, setView] = useViewMode('me-payslips');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/ess/payslips');
      const json = await res.json();
      setRows((json.data ?? []) as MyPayslip[]);
      setStanding(Boolean(json.paper_slip_standing));
    } catch {
      setRows([]);
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
        ) : rows.length === 0 ? (
          <EmptyState icon={Wallet} title={t('noPayslips')} />
        ) : (
          <DataList compact={view === 'compact'}>
            {rows.map((r) => (
              <DataCard
                key={r.id}
                onClick={() => open(r.id)}
                title={`${r.period_month ? String(r.period_month).padStart(2, '0') : '—'}/${r.period_year ?? '—'}`}
                subtitle={r.pay_date ? `${t('payDate')} ${r.pay_date}` : undefined}
                status={paperBadge(r.paper_status)}
                value={<MoneyValue satang={r.net_satang} emphasis="strong" tone="good" />}
                actions={
                  !r.paper_status && !standing ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={paperBusy === r.id}
                      onClick={(e) => { e.stopPropagation(); requestPaper(r.id); }}
                    >
                      {t('paperRequest')}
                    </Button>
                  ) : undefined
                }
              />
            ))}
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

      <div className="hidden print:block">
        {printSlip && <PayslipFormPrint data={printSlip} />}
      </div>
    </div>
  );
}
