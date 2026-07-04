'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, Coins, Wallet, TrendingDown, ChevronDown, ChevronRight, Plus, X, Printer, Lock } from 'lucide-react';
import {
  Button,
  EmptyState,
  PageHeader,
  SectionHeading,
  KpiRow,
  StatTile,
  MoneyValue,
  StatusBadge,
  useConfirm,
  toast,
} from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { formatBaht, bahtToSatang } from '@/lib/pos/money';

// Tip pool page — mirrors /hr/service-charge (00109 mirrors 00103) but tips are MANUAL-only:
// no recompute (no auto warning/leave/eval lines), every deduction is a manual line.
// Self-contained locale strings to avoid a large i18n block for a per-store admin surface.

interface StoreOpt { id: string; store_name: string }
interface TipDeduction { id: string; source_type: string; label: string; amount_satang: number; carry_satang: number; note: string | null; auto: boolean }
interface TipAllocation { id: string; user_id: string; allocated_satang: number; net_satang: number; deductions: TipDeduction[]; employee?: { display_name: string | null; username: string | null } | null }
interface TipPool { id: string; status: string; total_satang: number; pay_date: string | null; notes: string | null }
interface TipData { pool: TipPool | null; allocations: TipAllocation[]; totals: { allocated: number; deducted: number; net: number } }
interface EmployeeRef { id: string; display_name: string | null; username: string | null }
interface TipRow { userId: string; name: string; allocation: TipAllocation | null }

const PRINT_CSS = `@media print { @page { margin: 1.6cm; } .tip-noprint { display: none !important; } }`;

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function HrTipPoolPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'กองทุนทิป', subtitle: 'จัดสรรทิปต่อคนต่อเดือน (กรอกยอดเอง)', store: 'สาขา', month: 'งวด', noStores: 'ไม่มีสาขาที่จัดการได้', loadFailed: 'โหลดไม่สำเร็จ', poolTotal: 'ยอดทิปรวม', payDate: 'วันจ่าย', notes: 'หมายเหตุ', notesPh: 'หมายเหตุ (ถ้ามี)', draft: 'ร่าง', finalized: 'ปิดงวดแล้ว', createPool: 'สร้างกองทิป', savePool: 'บันทึกยอด', allocations: 'การจัดสรร', saveAllocations: 'บันทึกการจัดสรร', print: 'พิมพ์', finalize: 'ปิดงวด', colEmployee: 'พนักงาน', colAllocated: 'จัดสรร', colDeductions: 'หัก', colNet: 'สุทธิ', totals: 'รวม', noEmployees: 'ไม่มีพนักงาน', noDeductions: 'ไม่มีรายการหัก', addDeduction: 'เพิ่มรายการหัก', delete: 'ลบ', dedLabelPh: 'เหตุผล', savePoolFirst: 'บันทึกยอดกองก่อน', saveAllocHint: 'บันทึกการจัดสรรก่อนจึงเพิ่มรายการหักได้', finalizeConfirm: 'ปิดงวดกองทิปนี้? จะแก้ไขไม่ได้อีก', saved: 'บันทึกแล้ว', finalizedMsg: 'ปิดงวดแล้ว', locked: 'ปิดงวดแล้ว แก้ไขไม่ได้', invalid: 'กรอกจำนวนให้ถูกต้อง', add: 'เพิ่ม' }
    : { title: 'Tip pool', subtitle: 'Allocate tips per person per month (manual)', store: 'Store', month: 'Period', noStores: 'No manageable stores', loadFailed: 'Load failed', poolTotal: 'Total tips', payDate: 'Pay date', notes: 'Notes', notesPh: 'Notes (optional)', draft: 'Draft', finalized: 'Finalized', createPool: 'Create pool', savePool: 'Save total', allocations: 'Allocations', saveAllocations: 'Save allocations', print: 'Print', finalize: 'Finalize', colEmployee: 'Employee', colAllocated: 'Allocated', colDeductions: 'Deductions', colNet: 'Net', totals: 'Total', noEmployees: 'No employees', noDeductions: 'No deductions', addDeduction: 'Add deduction', delete: 'Delete', dedLabelPh: 'Reason', savePoolFirst: 'Save the pool total first', saveAllocHint: 'Save allocations before adding a deduction', finalizeConfirm: 'Finalize this tip pool? It cannot be edited afterwards.', saved: 'Saved', finalizedMsg: 'Finalized', locked: 'Finalized — locked', invalid: 'Enter a valid amount', add: 'Add' };

  const { confirm, dialog } = useConfirm();

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [month, setMonth] = useState<string>(() => currentMonth());
  const [employees, setEmployees] = useState<EmployeeRef[]>([]);
  const [data, setData] = useState<TipData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [poolTotalBaht, setPoolTotalBaht] = useState('');
  const [notes, setNotes] = useState('');
  const [savingPool, setSavingPool] = useState(false);
  const [allocInputs, setAllocInputs] = useState<Record<string, string>>({});
  const [savingAlloc, setSavingAlloc] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dedDraft, setDedDraft] = useState<Record<string, { label: string; amount: string }>>({});

  const periodMonth = `${month}-01`;
  const pool = data?.pool ?? null;
  const isFinalized = pool?.status === 'finalized';

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/manageable-stores');
        const json = await res.json();
        const list = (json.data ?? []) as StoreOpt[];
        setStores(list);
        setStoreId((prev) => prev || list[0]?.id || '');
      } catch { setStores([]); }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!storeId || !month) { setData(null); setEmployees([]); setLoading(false); return; }
    setLoading(true); setError(false);
    try {
      const [tipRes, empRes] = await Promise.all([
        fetch(`/api/hr/tip-pool?store_id=${storeId}&period_month=${month}-01`),
        fetch(`/api/hr/employees?store_id=${storeId}`),
      ]);
      if (!tipRes.ok || !empRes.ok) throw new Error('load failed');
      const tipJson = await tipRes.json();
      const empJson = await empRes.json();
      setData((tipJson.data ?? null) as TipData | null);
      const emps = (empJson.data ?? []) as { profile: EmployeeRef | null }[];
      setEmployees(emps.map((e) => e.profile).filter((p): p is EmployeeRef => !!p));
    } catch {
      setError(true); setData(null); setEmployees([]);
      toast({ type: 'error', title: L.loadFailed });
    } finally { setLoading(false); }
  }, [storeId, month, L.loadFailed]);

  useEffect(() => { load(); }, [load]);

  const rows: TipRow[] = useMemo(() => {
    const allocByUser = new Map<string, TipAllocation>();
    data?.allocations.forEach((a) => allocByUser.set(a.user_id, a));
    const seen = new Set<string>();
    const out: TipRow[] = [];
    employees.forEach((e) => { seen.add(e.id); out.push({ userId: e.id, name: e.display_name || e.username || '—', allocation: allocByUser.get(e.id) ?? null }); });
    data?.allocations.forEach((a) => { if (seen.has(a.user_id)) return; out.push({ userId: a.user_id, name: a.employee?.display_name || a.employee?.username || '—', allocation: a }); });
    return out;
  }, [employees, data]);

  useEffect(() => {
    setPoolTotalBaht(pool ? String(pool.total_satang / 100) : '');
    setNotes(pool?.notes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    const next: Record<string, string> = {};
    rows.forEach((r) => { const s = r.allocation?.allocated_satang ?? 0; next[r.userId] = s ? String(s / 100) : ''; });
    setAllocInputs(next);
  }, [rows]);

  const savePool = async () => {
    const amt = Number(poolTotalBaht);
    if (!Number.isFinite(amt) || amt < 0) { toast({ type: 'warning', title: L.invalid }); return; }
    setSavingPool(true);
    try {
      const res = await fetch('/api/hr/tip-pool', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ store_id: storeId, period_month: periodMonth, total_satang: bahtToSatang(amt), notes: notes.trim() || undefined }) });
      if (res.status === 409) { toast({ type: 'error', title: L.locked }); return; }
      if (!res.ok) { toast({ type: 'error', title: L.loadFailed }); return; }
      toast({ type: 'success', title: L.saved }); await load();
    } finally { setSavingPool(false); }
  };

  const saveAllocations = async () => {
    if (!pool) { toast({ type: 'warning', title: L.savePoolFirst }); return; }
    setSavingAlloc(true);
    try {
      const allocations = rows.map((r) => ({ user_id: r.userId, allocated_satang: bahtToSatang(Number(allocInputs[r.userId] || 0)) }));
      const res = await fetch(`/api/hr/tip-pool/${pool.id}/allocations`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allocations }) });
      if (!res.ok) { toast({ type: 'error', title: L.loadFailed }); return; }
      toast({ type: 'success', title: L.saved }); await load();
    } finally { setSavingAlloc(false); }
  };

  const addDeduction = async (allocId: string) => {
    const draft = dedDraft[allocId] || { label: '', amount: '' };
    const amt = Number(draft.amount);
    if (!draft.label.trim() || !Number.isFinite(amt) || amt <= 0) { toast({ type: 'warning', title: L.invalid }); return; }
    const res = await fetch(`/api/hr/tip-pool/allocations/${allocId}/deductions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: draft.label.trim(), amount_satang: bahtToSatang(amt) }) });
    if (!res.ok) { toast({ type: 'error', title: L.loadFailed }); return; }
    setDedDraft((p) => ({ ...p, [allocId]: { label: '', amount: '' } }));
    await load();
  };

  const deleteDeduction = async (id: string) => {
    const res = await fetch(`/api/hr/tip-pool/deductions/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast({ type: 'error', title: L.loadFailed }); return; }
    await load();
  };

  const finalize = async () => {
    if (!pool) return;
    if (!(await confirm({ title: L.finalizeConfirm, tone: 'danger', confirmLabel: L.finalize }))) return;
    setFinalizing(true);
    try {
      const res = await fetch(`/api/hr/tip-pool/${pool.id}/finalize`, { method: 'POST' });
      if (res.status === 409) { toast({ type: 'error', title: L.locked }); return; }
      if (!res.ok) { toast({ type: 'error', title: L.loadFailed }); return; }
      toast({ type: 'success', title: L.finalizedMsg }); await load();
    } finally { setFinalizing(false); }
  };

  const toggleRow = (userId: string) => setExpanded((prev) => { const next = new Set(prev); if (next.has(userId)) next.delete(userId); else next.add(userId); return next; });
  const payDateDisplay = pool?.pay_date ?? `${month}-15`;
  const busy = savingPool || savingAlloc || finalizing;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <style>{PRINT_CSS}</style>
      <PageHeader
        title={L.title}
        subtitle={L.subtitle}
        className="tip-noprint"
        actions={
          <>
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">{L.store}
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="control mt-1">
                {stores.length === 0 && <option value="">{L.noStores}</option>}
                {stores.map((s) => (<option key={s.id} value={s.id}>{s.store_name}</option>))}
              </select>
            </label>
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">{L.month}
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="control mt-1" />
            </label>
          </>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : stores.length === 0 ? (
        <EmptyState icon={Coins} title={L.noStores} />
      ) : error ? (
        <EmptyState icon={Coins} title={L.loadFailed} />
      ) : (
        <>
          <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 tip-noprint">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{L.poolTotal}</label>
                <div className="flex items-center gap-1">
                  <input type="number" inputMode="decimal" min={0} step={0.01} value={poolTotalBaht} disabled={isFinalized} onChange={(e) => setPoolTotalBaht(e.target.value)} placeholder="0.00" className={cn('control w-40', isFinalized && 'opacity-60')} />
                  <span className="text-sm text-gray-500 dark:text-gray-400">฿</span>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{L.payDate}</label>
                <input type="date" value={payDateDisplay} readOnly className={cn('control w-40 cursor-default opacity-70')} />
              </div>
              <div className="min-w-[12rem] flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{L.notes}</label>
                <input type="text" value={notes} disabled={isFinalized} onChange={(e) => setNotes(e.target.value)} placeholder={L.notesPh} className={cn('control w-full', isFinalized && 'opacity-60')} />
              </div>
              <div className="flex items-center gap-2 self-end pb-0.5">
                <StatusBadge tone={isFinalized ? 'good' : 'warn'} label={isFinalized ? L.finalized : L.draft} icon={isFinalized ? Lock : undefined} />
                {!isFinalized && (<Button onClick={savePool} isLoading={savingPool} disabled={busy} type="button">{pool ? L.savePool : L.createPool}</Button>)}
              </div>
            </div>
          </section>

          {data && (
            <KpiRow cols={3} className="tip-noprint">
              <StatTile label={L.colAllocated} value={<MoneyValue satang={data.totals.allocated} emphasis="kpi" />} icon={Wallet} tone="accent" />
              <StatTile label={L.colDeductions} value={<MoneyValue satang={-data.totals.deducted} emphasis="kpi" signed />} icon={TrendingDown} tone="critical" />
              <StatTile label={L.colNet} value={<MoneyValue satang={data.totals.net} emphasis="hero" tone="good" />} icon={Coins} tone="good" />
            </KpiRow>
          )}

          <SectionHeading
            title={L.allocations}
            className="tip-noprint"
            extra={
              <div className="flex flex-wrap gap-2">
                {!isFinalized && (<Button size="sm" type="button" onClick={saveAllocations} isLoading={savingAlloc} disabled={!pool || busy}>{L.saveAllocations}</Button>)}
                <Button variant="outline" size="sm" type="button" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} disabled={!data}>{L.print}</Button>
                {!isFinalized && (<Button variant="danger" size="sm" type="button" icon={<Lock className="h-4 w-4" />} onClick={finalize} isLoading={finalizing} disabled={!pool || busy}>{L.finalize}</Button>)}
              </div>
            }
          />

          {rows.length === 0 ? (
            <EmptyState icon={Coins} title={L.noEmployees} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2">{L.colEmployee}</th>
                    <th className="px-3 py-2 text-right">{L.colAllocated}</th>
                    <th className="px-3 py-2 text-right">{L.colDeductions}</th>
                    <th className="px-3 py-2 text-right">{L.colNet}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {rows.map((r) => {
                    const a = r.allocation;
                    const isOpen = expanded.has(r.userId);
                    const deducted = a ? a.deductions.reduce((s, d) => s + Math.max(0, d.amount_satang), 0) : 0;
                    const editedSatang = bahtToSatang(Number(allocInputs[r.userId] || 0));
                    const net = a ? a.net_satang : editedSatang;
                    const draft = dedDraft[r.userId] || { label: '', amount: '' };
                    return (
                      <Fragment key={r.userId}>
                        <tr className="bg-white dark:bg-gray-800">
                          <td className="px-3 py-2">
                            <button type="button" onClick={() => toggleRow(r.userId)} className="inline-flex items-center gap-1.5 text-left font-medium text-gray-900 dark:text-white">
                              {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                              {r.name}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <input type="number" inputMode="decimal" min={0} step={0.01} value={allocInputs[r.userId] ?? ''} disabled={isFinalized} onChange={(e) => setAllocInputs((prev) => ({ ...prev, [r.userId]: e.target.value }))} placeholder="0.00" className={cn('control w-28 text-right', isFinalized && 'opacity-60')} />
                              <span className="text-xs text-gray-400">฿</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">
                            {deducted > 0 ? <span className="text-red-600 dark:text-red-400">−{formatBaht(deducted)} ฿</span> : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-white">{formatBaht(net)} ฿</td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-gray-50 dark:bg-gray-800/40">
                            <td colSpan={4} className="px-3 py-3">
                              {a && a.deductions.length > 0 ? (
                                <ul className="space-y-1.5">
                                  {a.deductions.map((d) => (
                                    <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                                      <span className="text-gray-700 dark:text-gray-200">{d.label}</span>
                                      <span className="font-medium text-red-600 dark:text-red-400">−{formatBaht(d.amount_satang)} ฿</span>
                                      {d.note && <span className="text-gray-400">· {d.note}</span>}
                                      {!isFinalized && (
                                        <button type="button" onClick={() => deleteDeduction(d.id)} aria-label={L.delete} title={L.delete} className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 tip-noprint">
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              ) : (<p className="text-xs text-gray-400">{L.noDeductions}</p>)}
                              {a && !isFinalized && (
                                <div className="mt-2 flex flex-wrap items-center gap-2 tip-noprint">
                                  <input type="text" value={draft.label} onChange={(e) => setDedDraft((p) => ({ ...p, [r.userId]: { ...draft, label: e.target.value } }))} placeholder={L.dedLabelPh} className="control w-40" />
                                  <input type="number" inputMode="decimal" min={0} step={0.01} value={draft.amount} onChange={(e) => setDedDraft((p) => ({ ...p, [r.userId]: { ...draft, amount: e.target.value } }))} placeholder="0.00" className="control w-28" />
                                  <span className="text-xs text-gray-400">฿</span>
                                  <Button variant="ghost" size="sm" type="button" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => addDeduction(a.id)}>{L.add}</Button>
                                </div>
                              )}
                              {!a && (<p className="mt-1 text-xs text-gray-400">{L.saveAllocHint}</p>)}
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
                      <td className="px-3 py-2 text-gray-900 dark:text-white">{L.totals}</td>
                      <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{formatBaht(data.totals.allocated)} ฿</td>
                      <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">−{formatBaht(data.totals.deducted)} ฿</td>
                      <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{formatBaht(data.totals.net)} ฿</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </>
      )}
      {dialog}
    </div>
  );
}
