'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Wallet, Printer, X } from 'lucide-react';
import { Button, EmptyState, Modal, ModalFooter, PageHeader, DataList, DataCard, MoneyValue, ViewToggle, useViewMode, toast } from '@/components/ui';
import { PayslipView, type PayslipDetailData } from '@/components/hr/payslip-view';
import { PayslipFormPrint } from '@/components/hr/payslip-form-print';

interface MyPayslip {
  id: string;
  gross_satang: number;
  net_satang: number;
  period_year: number | null;
  period_month: number | null;
  pay_date: string | null;
}

const PRINT_CSS = `@media print { @page { size: 9in 5.5in; margin: 0.3in; } }`;

export default function MyPayslipsPage() {
  const t = useTranslations('hr.payslip');
  const [rows, setRows] = useState<MyPayslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [slip, setSlip] = useState<PayslipDetailData | null>(null);
  const [printSlip, setPrintSlip] = useState<PayslipDetailData | null>(null);
  const [view, setView] = useViewMode('me-payslips');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/ess/payslips');
        const json = await res.json();
        setRows((json.data ?? []) as MyPayslip[]);
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
                value={<MoneyValue satang={r.net_satang} emphasis="strong" tone="good" />}
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
