'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Loader2, ArrowLeft, GitCompareArrows } from 'lucide-react';
import { EmptyState, PageHeader, KpiRow, StatTile, MoneyValue, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

// P4.4 payslip-compare — put one employee's two payruns side by side (A vs B) with per-line and
// summary deltas, so HR can explain "why is this month's net different from last month". All data
// comes from existing HR endpoints (payruns list → payrun detail for the employee's slip id →
// payslip detail for itemized lines); no new API. Self-contained locale strings.
interface Company { id: string; name: string }
interface PayrunRow { id: string; period_year: number; period_month: number; status: string | null }
interface SlipSummary { id: string; user_id: string; name: string; gross_satang: number; sso_satang: number; tax_satang: number; total_deduction_satang: number; net_satang: number }
interface Line { type: string; label: string; amount_satang: number }
interface SlipDetail { earnings: Line[]; deductions: Line[]; summary: SlipSummary | null }

const baht = (satang: number) => (satang / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const payrunLabel = (p: PayrunRow) => `${String(p.period_month).padStart(2, '0')}/${p.period_year}${p.status ? ` · ${p.status}` : ''}`;

// merge two line lists by label into rows { label, a, b }
function mergeLines(a: Line[], b: Line[]): { label: string; a: number; b: number }[] {
  const map = new Map<string, { label: string; a: number; b: number }>();
  for (const l of a) {
    const r = map.get(l.label) ?? { label: l.label, a: 0, b: 0 };
    r.a += l.amount_satang;
    map.set(l.label, r);
  }
  for (const l of b) {
    const r = map.get(l.label) ?? { label: l.label, a: 0, b: 0 };
    r.b += l.amount_satang;
    map.set(l.label, r);
  }
  return [...map.values()];
}

export default function PayslipComparePage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { back: 'กลับ', title: 'เทียบสลิปเงินเดือน', subtitle: 'วางสลิปพนักงานคนเดียว 2 งวดเทียบกัน', company: 'บริษัท', periodA: 'งวด A', periodB: 'งวด B', employee: 'พนักงาน', pick: '—', noCommon: 'ไม่มีพนักงานที่อยู่ทั้งสองงวด', selectAll: 'เลือกบริษัท 2 งวด และพนักงาน', earnings: 'รายรับ', deductions: 'รายการหัก', gross: 'รายรับรวม', sso: 'ประกันสังคม', tax: 'ภาษี', totalDed: 'หักรวม', net: 'สุทธิ', colItem: 'รายการ', delta: 'ต่าง', loadFailed: 'โหลดไม่สำเร็จ', noSlipA: 'ไม่มีสลิปคนนี้ในงวด A', noSlipB: 'ไม่มีสลิปคนนี้ในงวด B' }
    : { back: 'Back', title: 'Compare payslips', subtitle: "Put one employee's two payruns side by side", company: 'Company', periodA: 'Period A', periodB: 'Period B', employee: 'Employee', pick: '—', noCommon: 'No employee appears in both payruns', selectAll: 'Pick a company, two payruns, and an employee', earnings: 'Earnings', deductions: 'Deductions', gross: 'Gross', sso: 'SSO', tax: 'Tax', totalDed: 'Total deductions', net: 'Net', colItem: 'Item', delta: 'Δ', loadFailed: 'Load failed', noSlipA: 'No slip for this employee in A', noSlipB: 'No slip for this employee in B' };

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [payruns, setPayruns] = useState<PayrunRow[]>([]);
  const [payrunA, setPayrunA] = useState('');
  const [payrunB, setPayrunB] = useState('');
  const [slipsA, setSlipsA] = useState<SlipSummary[]>([]);
  const [slipsB, setSlipsB] = useState<SlipSummary[]>([]);
  const [userId, setUserId] = useState('');
  const [detailA, setDetailA] = useState<SlipDetail | null>(null);
  const [detailB, setDetailB] = useState<SlipDetail | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // companies once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/companies');
        setCompanies(((await res.json()).data ?? []) as Company[]);
      } catch { toast({ type: 'error', title: L.loadFailed }); }
    })();
  }, [L.loadFailed]);

  // payruns when company changes
  useEffect(() => {
    setPayrunA(''); setPayrunB(''); setSlipsA([]); setSlipsB([]); setUserId(''); setDetailA(null); setDetailB(null);
    if (!companyId) { setPayruns([]); return; }
    (async () => {
      try {
        const res = await fetch(`/api/hr/payruns?company_id=${companyId}`);
        setPayruns(((await res.json()).data ?? []) as PayrunRow[]);
      } catch { toast({ type: 'error', title: L.loadFailed }); }
    })();
  }, [companyId, L.loadFailed]);

  const loadRunSlips = useCallback(async (payrunId: string): Promise<SlipSummary[]> => {
    if (!payrunId) return [];
    const res = await fetch(`/api/hr/payruns/${payrunId}`);
    return (((await res.json()).data?.payslips ?? []) as SlipSummary[]);
  }, []);

  // when both payruns picked, load their slip lists (for the employee picker)
  useEffect(() => {
    setUserId(''); setDetailA(null); setDetailB(null);
    if (!payrunA || !payrunB) { setSlipsA([]); setSlipsB([]); return; }
    (async () => {
      setLoadingRun(true);
      try {
        const [a, b] = await Promise.all([loadRunSlips(payrunA), loadRunSlips(payrunB)]);
        setSlipsA(a); setSlipsB(b);
      } catch { toast({ type: 'error', title: L.loadFailed }); }
      finally { setLoadingRun(false); }
    })();
  }, [payrunA, payrunB, loadRunSlips, L.loadFailed]);

  // employees present in BOTH payruns
  const commonEmployees = useMemo(() => {
    const bIds = new Set(slipsB.map((s) => s.user_id));
    return slipsA.filter((s) => bIds.has(s.user_id)).sort((x, y) => x.name.localeCompare(y.name));
  }, [slipsA, slipsB]);

  // load both slip details for the chosen employee
  useEffect(() => {
    setDetailA(null); setDetailB(null);
    if (!userId) return;
    const slipA = slipsA.find((s) => s.user_id === userId);
    const slipB = slipsB.find((s) => s.user_id === userId);
    if (!slipA || !slipB) return;
    (async () => {
      setLoadingDetail(true);
      try {
        const [ra, rb] = await Promise.all([
          fetch(`/api/hr/payslips/${slipA.id}`).then((r) => r.json()),
          fetch(`/api/hr/payslips/${slipB.id}`).then((r) => r.json()),
        ]);
        setDetailA({ earnings: ra.data?.earnings ?? [], deductions: ra.data?.deductions ?? [], summary: slipA });
        setDetailB({ earnings: rb.data?.earnings ?? [], deductions: rb.data?.deductions ?? [], summary: slipB });
      } catch { toast({ type: 'error', title: L.loadFailed }); }
      finally { setLoadingDetail(false); }
    })();
  }, [userId, slipsA, slipsB, L.loadFailed]);

  const ready = detailA?.summary && detailB?.summary;
  const earningRows = ready ? mergeLines(detailA!.earnings, detailB!.earnings) : [];
  const deductionRows = ready ? mergeLines(detailA!.deductions, detailB!.deductions) : [];
  const summaryRows = ready
    ? ([
        { key: L.gross, a: detailA!.summary!.gross_satang, b: detailB!.summary!.gross_satang },
        { key: L.sso, a: detailA!.summary!.sso_satang, b: detailB!.summary!.sso_satang },
        { key: L.tax, a: detailA!.summary!.tax_satang, b: detailB!.summary!.tax_satang },
        { key: L.totalDed, a: detailA!.summary!.total_deduction_satang, b: detailB!.summary!.total_deduction_satang },
        { key: L.net, a: detailA!.summary!.net_satang, b: detailB!.summary!.net_satang },
      ])
    : [];

  const DeltaCell = ({ a, b }: { a: number; b: number }) => {
    const d = b - a;
    return (
      <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', d === 0 ? 'text-gray-400' : d > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
        {d === 0 ? '—' : `${d > 0 ? '+' : ''}${baht(d)}`}
      </td>
    );
  };

  const CompareTable = ({ heading, rows }: { heading: string; rows: { label: string; a: number; b: number }[] }) => (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="w-full min-w-[30rem] text-sm">
        <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
          <tr>
            <th className="px-3 py-2">{heading}</th>
            <th className="px-3 py-2 text-right">A</th>
            <th className="px-3 py-2 text-right">B</th>
            <th className="px-3 py-2 text-right">{L.delta}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((r) => (
            <tr key={r.label} className="bg-white dark:bg-gray-800">
              <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{r.label}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{baht(r.a)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{baht(r.b)}</td>
              <DeltaCell a={r.a} b={r.b} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Link href="/hr/payroll" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600 dark:text-gray-400">
        <ArrowLeft className="h-4 w-4" /> {L.back}
      </Link>
      <PageHeader title={L.title} subtitle={L.subtitle} />

      {/* selectors */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.company}
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="control mt-1">
              <option value="">{L.pick}</option>
              {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.employee}
            <select value={userId} onChange={(e) => setUserId(e.target.value)} disabled={commonEmployees.length === 0} className="control mt-1">
              <option value="">{L.pick}</option>
              {commonEmployees.map((s) => (<option key={s.user_id} value={s.user_id}>{s.name}</option>))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.periodA}
            <select value={payrunA} onChange={(e) => setPayrunA(e.target.value)} disabled={!companyId} className="control mt-1">
              <option value="">{L.pick}</option>
              {payruns.map((p) => (<option key={p.id} value={p.id} disabled={p.id === payrunB}>{payrunLabel(p)}</option>))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-400">{L.periodB}
            <select value={payrunB} onChange={(e) => setPayrunB(e.target.value)} disabled={!companyId} className="control mt-1">
              <option value="">{L.pick}</option>
              {payruns.map((p) => (<option key={p.id} value={p.id} disabled={p.id === payrunA}>{payrunLabel(p)}</option>))}
            </select>
          </label>
        </div>
        {payrunA && payrunB && !loadingRun && commonEmployees.length === 0 && (
          <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">{L.noCommon}</p>
        )}
      </section>

      {loadingRun || loadingDetail ? (
        <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : ready ? (
        <>
          {/* Lead with the net figures + the delta that explains the difference */}
          <KpiRow cols={3}>
            <StatTile label={`${L.net} A`} value={<MoneyValue satang={detailA!.summary!.net_satang} emphasis="kpi" />} />
            <StatTile label={`${L.net} B`} value={<MoneyValue satang={detailB!.summary!.net_satang} emphasis="kpi" />} />
            <StatTile
              label={`${L.net} ${L.delta}`}
              value={<MoneyValue satang={detailB!.summary!.net_satang - detailA!.summary!.net_satang} emphasis="hero" signed />}
            />
          </KpiRow>

          <div className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{L.earnings}</h2>
            <CompareTable heading={L.colItem} rows={earningRows} />
          </div>
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{L.deductions}</h2>
            <CompareTable heading={L.colItem} rows={deductionRows} />
          </div>
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{L.net}</h2>
            <div className="overflow-x-auto rounded-lg border-2 border-indigo-200 dark:border-indigo-800">
              <table className="w-full min-w-[30rem] text-sm">
                <thead className="bg-indigo-50 text-left text-xs font-medium text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300">
                  <tr>
                    <th className="px-3 py-2">{L.colItem}</th>
                    <th className="px-3 py-2 text-right">A</th>
                    <th className="px-3 py-2 text-right">B</th>
                    <th className="px-3 py-2 text-right">{L.delta}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {summaryRows.map((r) => (
                    <tr key={r.key} className={cn('bg-white dark:bg-gray-800', r.key === L.net && 'font-bold')}>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{r.key}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{baht(r.a)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{baht(r.b)}</td>
                      <DeltaCell a={r.a} b={r.b} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <EmptyState icon={GitCompareArrows} title={L.selectAll} />
      )}
    </div>
  );
}
