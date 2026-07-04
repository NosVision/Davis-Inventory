'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, BarChart3, Download, FileText } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

// §J9 P5.2 statutory reports UI — view/download ภ.ง.ด.1 / สปส.1-10 / ทะเบียนเงินเดือน / ภ.ง.ด.1ก /
// 50 ทวิ from finalized payruns. Monthly types need a month; annual types (pnd1k/cert50twi) don't.
// CSV e-filing for pnd1/pnd1k; 50 ทวิ PDF for cert50twi. Self-contained locale strings.
interface Company { id: string; name: string }
type ReportType = 'pnd1' | 'sso' | 'register' | 'pnd1k' | 'cert50twi';
const MONTHLY: ReportType[] = ['pnd1', 'sso', 'register'];

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
const baht = (s: number) => (Number(s) / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Col { key: string; label: string; money?: boolean }
type Row = Record<string, unknown>;

export default function HrReportsPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'รายงานภาษี/ประกันสังคม', subtitle: 'ภ.ง.ด.1 · สปส.1-10 · ทะเบียนเงินเดือน · ภ.ง.ด.1ก · 50 ทวิ (จากงวดที่ปิดแล้ว)', company: 'บริษัท', year: 'ปี (พ.ศ.)', month: 'เดือน', pick: '—', load: 'ดูรายงาน', csv: 'ดาวน์โหลด CSV (e-filing)', pdf: 'ออก 50 ทวิ PDF', empty: 'ไม่มีข้อมูล (ต้องมีงวดที่ปิดแล้ว)', loadFailed: 'โหลดไม่สำเร็จ', pickCompany: 'เลือกบริษัทก่อน', total: 'รวม', name: 'ชื่อ', taxId: 'เลขผู้เสียภาษี', ssoNo: 'เลข สปส.', income: 'เงินได้', tax: 'ภาษีหัก', wageBase: 'ฐานค่าจ้าง', empSso: 'สมทบลูกจ้าง', erSso: 'สมทบนายจ้าง', gross: 'รายรับ', ded: 'หักรวม', net: 'สุทธิ', sso: 'ปกส.', months: 'เดือน', pdfDone: 'สร้าง PDF แล้ว', pdfFail: 'สร้าง PDF ไม่สำเร็จ' }
    : { title: 'Tax / SSO reports', subtitle: 'PND1 · SSO 1-10 · payroll register · PND1Kor · 50 Twi (from finalized payruns)', company: 'Company', year: 'Year (BE)', month: 'Month', pick: '—', load: 'View', csv: 'Download CSV (e-filing)', pdf: 'Generate 50 Twi PDF', empty: 'No data (needs a finalized payrun)', loadFailed: 'Load failed', pickCompany: 'Pick a company first', total: 'Total', name: 'Name', taxId: 'Tax ID', ssoNo: 'SSO no.', income: 'Income', tax: 'Tax', wageBase: 'Wage base', empSso: 'Employee', erSso: 'Employer', gross: 'Gross', ded: 'Deductions', net: 'Net', sso: 'SSO', months: 'Months', pdfDone: 'PDF created', pdfFail: 'PDF failed' };

  const TABS: { key: ReportType; label: string }[] = [
    { key: 'pnd1', label: 'ภ.ง.ด.1' }, { key: 'sso', label: 'สปส.1-10' }, { key: 'register', label: isTh ? 'ทะเบียนเงินเดือน' : 'Register' }, { key: 'pnd1k', label: 'ภ.ง.ด.1ก' }, { key: 'cert50twi', label: '50 ทวิ' },
  ];

  const nowBe = new Date().getFullYear() + 543;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [yearBe, setYearBe] = useState(String(nowBe));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [type, setType] = useState<ReportType>('pnd1');
  const [payload, setPayload] = useState<{ type: ReportType; data: Record<string, unknown> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/companies');
        setCompanies(((await res.json()).data ?? []) as Company[]);
      } catch { toast({ type: 'error', title: L.loadFailed }); }
    })();
  }, [L.loadFailed]);

  const yearAd = Number(yearBe) - 543;
  const qs = useCallback((extra?: string) => {
    const p = new URLSearchParams({ type, company_id: companyId, year: String(yearAd) });
    if (MONTHLY.includes(type)) p.set('month', month);
    return p.toString() + (extra ? `&${extra}` : '');
  }, [type, companyId, yearAd, month]);

  const load = async () => {
    if (!companyId) { toast({ type: 'warning', title: L.pickCompany }); return; }
    setLoading(true);
    setPayload(null);
    try {
      const res = await fetch(`/api/hr/reports?${qs()}`);
      const json = await res.json();
      if (!res.ok) { toast({ type: 'error', title: json?.error || L.loadFailed }); return; }
      setPayload({ type, data: json.data as Record<string, unknown> });
    } catch { toast({ type: 'error', title: L.loadFailed }); }
    finally { setLoading(false); }
  };

  const downloadCsv = async () => {
    try {
      const res = await fetch(`/api/hr/reports?${qs('format=csv')}`);
      if (!res.ok) { toast({ type: 'error', title: L.loadFailed }); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${type}_${yearBe}${MONTHLY.includes(type) ? '-' + month : ''}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { toast({ type: 'error', title: L.loadFailed }); }
  };

  const downloadCert50Pdf = async () => {
    const data = payload?.data as { company?: string; certificates?: unknown[] } | undefined;
    if (!data?.certificates?.length) return;
    setPdfBusy(true);
    try {
      const { buildCert50TwiPdf, downloadBlob } = await import('./_components/cert50twi-pdf');
      const now = new Date();
      const TH_M = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
      const blob = await buildCert50TwiPdf({
        company_name: data.company ?? '',
        year: yearAd,
        issue_date_label: `${now.getDate()} ${TH_M[now.getMonth()]} ${now.getFullYear() + 543}`,
        rows: (data.certificates as Record<string, number & string>[]).map((c) => ({
          employee_name: String(c.employee_name ?? ''),
          tax_id: (c.tax_id as string) ?? null,
          total_income_satang: Number(c.total_income_satang),
          total_tax_satang: Number(c.total_tax_satang),
          total_sso_satang: Number(c.total_sso_satang),
          months_count: Number(c.months_count),
        })),
      });
      downloadBlob(blob, `50twi_${yearBe}.pdf`);
      toast({ type: 'success', title: L.pdfDone });
    } catch { toast({ type: 'error', title: L.pdfFail }); }
    finally { setPdfBusy(false); }
  };

  // per-type table spec
  const table = useMemo((): { cols: Col[]; rows: Row[]; totals?: Row } | null => {
    if (!payload) return null;
    const d = payload.data as Record<string, unknown>;
    const rep = d.report as Record<string, unknown> | undefined;
    switch (payload.type) {
      case 'pnd1':
      case 'pnd1k': {
        const lines = (rep?.lines ?? []) as Row[];
        return { cols: [{ key: 'employee_name', label: L.name }, { key: 'tax_id', label: L.taxId }, { key: 'income_satang', label: L.income, money: true }, { key: 'tax_satang', label: L.tax, money: true }], rows: lines, totals: { employee_name: L.total, income_satang: rep?.total_income_satang, tax_satang: rep?.total_tax_satang } };
      }
      case 'sso': {
        const lines = (rep?.lines ?? []) as Row[];
        return { cols: [{ key: 'employee_name', label: L.name }, { key: 'sso_no', label: L.ssoNo }, { key: 'wage_base_satang', label: L.wageBase, money: true }, { key: 'employee_satang', label: L.empSso, money: true }, { key: 'employer_satang', label: L.erSso, money: true }], rows: lines, totals: { employee_name: L.total, wage_base_satang: rep?.total_wage_base_satang, employee_satang: rep?.total_employee_satang, employer_satang: rep?.total_employer_satang } };
      }
      case 'register': {
        const lines = (rep?.lines ?? []) as Row[];
        return { cols: [{ key: 'employee_name', label: L.name }, { key: 'gross_satang', label: L.gross, money: true }, { key: 'sso_satang', label: L.sso, money: true }, { key: 'tax_satang', label: L.tax, money: true }, { key: 'total_deduction_satang', label: L.ded, money: true }, { key: 'net_satang', label: L.net, money: true }], rows: lines, totals: { employee_name: L.total, gross_satang: rep?.total_gross_satang, sso_satang: rep?.total_sso_satang, tax_satang: rep?.total_tax_satang, total_deduction_satang: rep?.total_deduction_satang, net_satang: rep?.total_net_satang } };
      }
      case 'cert50twi': {
        const certs = (d.certificates ?? []) as Row[];
        return { cols: [{ key: 'employee_name', label: L.name }, { key: 'tax_id', label: L.taxId }, { key: 'months_count', label: L.months }, { key: 'total_income_satang', label: L.income, money: true }, { key: 'total_tax_satang', label: L.tax, money: true }], rows: certs };
      }
    }
  }, [payload, L]);

  const cell = (c: Col, r: Row): string => {
    const v = r[c.key];
    if (v == null || v === '') return c.money ? '0.00' : '—';
    return c.money ? baht(Number(v)) : String(v);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{L.title}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{L.subtitle}</p>
      </div>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.company}
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={cn('mt-1 min-w-[12rem]', inputCls)}>
              <option value="">{L.pick}</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.year}
            <input type="number" value={yearBe} onChange={(e) => setYearBe(e.target.value)} className={cn('mt-1 w-24', inputCls)} />
          </label>
          {MONTHLY.includes(type) && (
            <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.month}
              <select value={month} onChange={(e) => setMonth(e.target.value)} className={cn('mt-1 w-20', inputCls)}>
                {Array.from({ length: 12 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}</option>))}
              </select>
            </label>
          )}
          <Button type="button" onClick={load} isLoading={loading} icon={<BarChart3 className="h-4 w-4" />}>{L.load}</Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => { setType(t.key); setPayload(null); }}
              className={cn('rounded-full border px-3 py-1.5 text-sm transition-colors', t.key === type ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'border-gray-300 text-gray-600 hover:border-indigo-300 dark:border-gray-600 dark:text-gray-300')}>
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : payload && table ? (
        <>
          <div className="flex flex-wrap justify-end gap-2">
            {(payload.type === 'pnd1' || payload.type === 'pnd1k') && (
              <Button variant="outline" type="button" onClick={downloadCsv} icon={<Download className="h-4 w-4" />}>{L.csv}</Button>
            )}
            {payload.type === 'cert50twi' && (table.rows.length > 0) && (
              <Button type="button" onClick={downloadCert50Pdf} isLoading={pdfBusy} icon={<FileText className="h-4 w-4" />}>{L.pdf}</Button>
            )}
          </div>
          {table.rows.length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800">{L.empty}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                  <tr>{table.cols.map((c) => (<th key={c.key} className={cn('px-3 py-2', c.money && 'text-right')}>{c.label}</th>))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {table.rows.map((r, i) => (
                    <tr key={i} className="bg-white dark:bg-gray-800">
                      {table.cols.map((c) => (<td key={c.key} className={cn('px-3 py-2', c.money ? 'text-right tabular-nums text-gray-700 dark:text-gray-200' : 'text-gray-800 dark:text-gray-100')}>{cell(c, r)}</td>))}
                    </tr>
                  ))}
                  {table.totals && (
                    <tr className="bg-gray-50 font-bold dark:bg-gray-800/60">
                      {table.cols.map((c) => (<td key={c.key} className={cn('px-3 py-2', c.money ? 'text-right tabular-nums text-gray-900 dark:text-white' : 'text-gray-900 dark:text-white')}>{table.totals![c.key] != null ? (c.money ? baht(Number(table.totals![c.key])) : String(table.totals![c.key])) : ''}</td>))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-gray-400"><BarChart3 className="h-3.5 w-3.5" /> {L.subtitle}</p>
      )}
    </div>
  );
}
