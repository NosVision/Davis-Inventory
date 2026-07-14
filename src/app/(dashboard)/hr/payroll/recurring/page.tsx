'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, Search } from 'lucide-react';
import { Button, PageHeader } from '@/components/ui';
import { formatBaht } from '@/lib/pos/money';
import { RECURRING_EARNING_CODES, RECURRING_DEDUCTION_CODES } from '@/lib/hr/recurring';
import { cn } from '@/lib/utils/cn';
import { CellEditorModal } from './_components/cell-editor-modal';
import { BulkAddModal } from './_components/bulk-add-modal';
import type { GridEmployee, RecurringItem } from './_components/types';

interface CompanyOpt { id: string; name: string }
interface CellTarget { employee: GridEmployee; kind: 'earning' | 'deduction'; code: string }

/** 'YYYY-MM' of today — the grid's "now" for window/expiry states. */
function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Is the item's period window open for `period`? (active flag checked separately) */
function inWindow(it: RecurringItem, period: string): boolean {
  if (it.start_period && it.start_period > period) return false;
  if (it.end_period && it.end_period < period) return false;
  return true;
}

const COLUMNS: { kind: 'earning' | 'deduction'; code: string }[] = [
  ...RECURRING_EARNING_CODES.map((code) => ({ kind: 'earning' as const, code })),
  ...RECURRING_DEDUCTION_CODES.map((code) => ({ kind: 'deduction' as const, code })),
];

// /hr/payroll/recurring — the company-wide recurring-items grid (rows = employees, columns =
// the typed item codes). Set once → every future payrun pulls it automatically; end month =
// auto-expiry the generate filter enforces. Full HR only (API-gated).
export default function RecurringGridPage() {
  const t = useTranslations('hr.payroll.recurringPage');
  const tCode = useTranslations('hr.payroll.recurringModal');

  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [employees, setEmployees] = useState<GridEmployee[]>([]);
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [onlyWithItems, setOnlyWithItems] = useState(false);
  const [editor, setEditor] = useState<CellTarget | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const period = currentPeriod();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/companies');
        const json = await res.json();
        const list = (json.data ?? []) as CompanyOpt[];
        setCompanies(list);
        if (list.length > 0) setCompanyId((prev) => prev || list[0].id);
      } catch {
        setCompanies([]);
      }
    })();
  }, []);

  // Monotonic sequence: a slow response for a previous company must never overwrite the
  // currently-selected company's grid.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!companyId) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/payroll/recurring?company_id=${companyId}`);
      const json = await res.json();
      if (seq !== loadSeq.current) return; // superseded by a newer load
      setEmployees((json.data?.employees ?? []) as GridEmployee[]);
      setItems((json.data?.items ?? []) as RecurringItem[]);
    } catch {
      if (seq !== loadSeq.current) return;
      setEmployees([]);
      setItems([]);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  // key `${employee_id}|${kind}|${code}` → items (all lifecycles; cell renders by state)
  const cellItems = useMemo(() => {
    const map = new Map<string, RecurringItem[]>();
    for (const it of items) {
      const key = `${it.employee_id}|${it.kind}|${it.code}`;
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    return map;
  }, [items]);

  const empIdsWithItems = useMemo(() => new Set(items.map((i) => i.employee_id)), [items]);

  const visibleEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (onlyWithItems && !empIdsWithItems.has(e.id)) return false;
      if (q && !e.name.toLowerCase().includes(q) && !(e.position ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [employees, search, onlyWithItems, empIdsWithItems]);

  // footer totals: current in-window active satang per column
  const columnTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const it of items) {
      if (!it.active || !inWindow(it, period)) continue;
      const key = `${it.kind}|${it.code}`;
      totals.set(key, (totals.get(key) ?? 0) + it.amount_satang);
    }
    return totals;
  }, [items, period]);

  const monthlyEarning = COLUMNS.filter((c) => c.kind === 'earning').reduce((s, c) => s + (columnTotals.get(`${c.kind}|${c.code}`) ?? 0), 0);
  const monthlyDeduction = COLUMNS.filter((c) => c.kind === 'deduction').reduce((s, c) => s + (columnTotals.get(`${c.kind}|${c.code}`) ?? 0), 0);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
              {t('company')}
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="control mt-1">
                {companies.length === 0 && <option value="">—</option>}
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <Button onClick={() => setBulkOpen(true)} disabled={!companyId || employees.length === 0} icon={<Plus className="h-4 w-4" />}>
              {t('bulkAdd')}
            </Button>
          </>
        }
      />

      {/* toolbar: search + filter + monthly commitment chips */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="control w-full !pl-9"
          />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={onlyWithItems} onChange={(e) => setOnlyWithItems(e.target.checked)} className="rounded border-gray-300" />
          {t('onlyWithItems')}
        </label>
        <div className="ml-auto flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-300">
            {t('monthlyEarning')} {formatBaht(monthlyEarning)} ฿
          </span>
          <span className="rounded-full bg-red-50 px-3 py-1 font-semibold text-red-700 dark:bg-red-900/25 dark:text-red-300">
            {t('monthlyDeduction')} {formatBaht(monthlyDeduction)} ฿
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : employees.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">{t('noEmployees')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left dark:border-gray-700">
                <th className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  {t('employee')}
                </th>
                {COLUMNS.map((c) => (
                  <th key={`${c.kind}|${c.code}`} className="whitespace-nowrap px-2 py-2 text-right">
                    <span className={cn('text-xs font-semibold', c.kind === 'earning' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300')}>
                      {tCode(`code.${c.code}`)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {visibleEmployees.map((emp) => (
                <tr key={emp.id} className="group">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 group-hover:bg-gray-50 dark:bg-gray-800 dark:group-hover:bg-gray-700/40">
                    <div className="font-medium text-gray-900 dark:text-white">{emp.name}</div>
                    {emp.position && <div className="text-[11px] text-gray-400">{emp.position}</div>}
                  </td>
                  {COLUMNS.map((c) => {
                    const list = cellItems.get(`${emp.id}|${c.kind}|${c.code}`) ?? [];
                    const live = list.filter((it) => it.active && inWindow(it, period));
                    const sum = live.reduce((s, it) => s + it.amount_satang, 0);
                    const ending = live.filter((it) => it.end_period).sort((a, b) => (a.end_period! < b.end_period! ? -1 : 1))[0]?.end_period ?? null;
                    const hasDead = list.length > 0 && live.length === 0;
                    return (
                      <td key={`${c.kind}|${c.code}`} className="px-1 py-1 text-right">
                        <button
                          onClick={() => setEditor({ employee: emp, kind: c.kind, code: c.code })}
                          className={cn(
                            'w-full min-w-[72px] rounded-md px-2 py-1 text-right tabular-nums transition-colors',
                            'hover:bg-indigo-50 hover:ring-1 hover:ring-indigo-300 dark:hover:bg-indigo-900/20',
                            live.length === 0 && 'text-gray-300 dark:text-gray-600'
                          )}
                          title={t('editCell')}
                        >
                          {live.length > 0 ? (
                            <>
                              <span className={cn('font-medium', c.kind === 'earning' ? 'text-gray-900 dark:text-white' : 'text-red-700 dark:text-red-300')}>
                                {formatBaht(sum)}
                              </span>
                              {live.length > 1 && <span className="ml-1 text-[10px] text-gray-400">+{live.length - 1}</span>}
                              {ending && (
                                <div className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                  {t('until')} {ending.slice(5)}/{ending.slice(2, 4)}
                                </div>
                              )}
                            </>
                          ) : hasDead ? (
                            <span className="text-[11px] text-gray-400 line-through">{t('ended')}</span>
                          ) : (
                            '—'
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold dark:border-gray-600 dark:bg-gray-700/40">
                <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-gray-700 dark:bg-gray-700/40 dark:text-gray-200">
                  {t('totalPerMonth')}
                </td>
                {COLUMNS.map((c) => {
                  const total = columnTotals.get(`${c.kind}|${c.code}`) ?? 0;
                  return (
                    <td key={`${c.kind}|${c.code}`} className="px-2 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">
                      {total > 0 ? formatBaht(total) : '—'}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400">{t('travelHint')}</p>

      {editor && (
        <CellEditorModal
          employee={editor.employee}
          kind={editor.kind}
          code={editor.code}
          currentPeriod={period}
          items={cellItems.get(`${editor.employee.id}|${editor.kind}|${editor.code}`) ?? []}
          onClose={() => setEditor(null)}
          onChanged={load}
        />
      )}
      {bulkOpen && companyId && (
        <BulkAddModal
          companyId={companyId}
          employees={employees}
          currentPeriod={period}
          onClose={() => setBulkOpen(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}
