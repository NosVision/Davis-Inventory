'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, Archive, X } from 'lucide-react';
import { Button, Select, EmptyState, Modal, ModalFooter, PageHeader, DataList, DataCard, MoneyValue } from '@/components/ui';
import { ImportedPayslipView, periodLabel, type ImportedSlip } from '@/components/hr/imported-payslip-view';

interface Facets {
  companies: { id: string; name: string; n: number }[];
  months: string[]; // 'YYYY-MM', newest first
}

export default function ImportedPayslipsPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'สลิปย้อนหลัง (นำเข้า)', subtitle: 'ข้อมูลเงินเดือนเก่าที่นำเข้าจากไฟล์ Payment', branch: 'สาขา', month: 'เดือน', empty: 'ไม่มีข้อมูลในเดือนนี้', people: 'คน', close: 'ปิด', unlinked: 'ยังไม่จับคู่พนักงาน' }
    : { title: 'Imported payslips', subtitle: 'Legacy pay figures imported from the Payment files', branch: 'Branch', month: 'Month', empty: 'No data for this month', people: 'people', close: 'Close', unlinked: 'Not linked to an employee' };

  const [facets, setFacets] = useState<Facets>({ companies: [], months: [] });
  const [companyId, setCompanyId] = useState('');
  const [ym, setYm] = useState('');
  const [rows, setRows] = useState<ImportedSlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [slip, setSlip] = useState<ImportedSlip | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/imported-payslips?facets=1');
        const json = (await res.json()) as Facets;
        setFacets(json);
        if (json.companies.length) setCompanyId(json.companies[0].id);
        if (json.months.length) setYm(json.months[0]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!companyId || !ym) return;
    setLoading(true);
    const [year, month] = ym.split('-');
    try {
      const res = await fetch(`/api/hr/imported-payslips?company_id=${companyId}&year=${year}&month=${Number(month)}`);
      const json = await res.json();
      setRows((json.data ?? []) as ImportedSlip[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, ym]);

  useEffect(() => { load(); }, [load]);

  const monthOptions = useMemo(
    () => facets.months.map((m) => {
      const [y, mo] = m.split('-');
      return { value: m, label: periodLabel(Number(y), Number(mo), isTh) };
    }),
    [facets.months, isTh],
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <PageHeader title={L.title} subtitle={L.subtitle} />

      <div className="grid grid-cols-2 gap-3">
        <Select
          label={L.branch}
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          options={facets.companies.map((c) => ({ value: c.id, label: `${c.name} (${c.n})` }))}
        />
        <Select
          label={L.month}
          value={ym}
          onChange={(e) => setYm(e.target.value)}
          options={monthOptions}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Archive} title={L.empty} />
      ) : (
        <>
          <div className="px-1 text-xs text-gray-400">{rows.length} {L.people}</div>
          <DataList>
            {rows.map((r) => (
              <DataCard
                key={r.id}
                onClick={() => setSlip(r)}
                title={r.name_th || r.name_en || r.nickname || '—'}
                subtitle={[r.nickname, r.position_text].filter(Boolean).join(' · ') || undefined}
                status={!r.employee_id && !r.pending_identity_id ? <span className="text-xs text-amber-600 dark:text-amber-400">{L.unlinked}</span> : undefined}
                value={<MoneyValue satang={r.net_satang ?? 0} emphasis="strong" tone="good" />}
              />
            ))}
          </DataList>
        </>
      )}

      {slip && (
        <Modal isOpen onClose={() => setSlip(null)} title={L.title} size="lg">
          <div className="max-h-[70vh] overflow-y-auto">
            <ImportedPayslipView data={slip} />
          </div>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setSlip(null)} icon={<X className="h-4 w-4" />}>{L.close}</Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
