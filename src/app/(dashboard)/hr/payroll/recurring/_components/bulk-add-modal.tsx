'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Button, Modal, ModalFooter, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { bahtToSatang } from '@/lib/pos/money';
import { RECURRING_EARNING_CODES, RECURRING_DEDUCTION_CODES } from '@/lib/hr/recurring';
import type { GridEmployee } from './types';

interface BulkAddModalProps {
  companyId: string;
  employees: GridEmployee[];
  currentPeriod: string; // 'YYYY-MM'
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

// Bulk add: the same recurring item to many employees at once — the "travel allowance for the
// whole company, one time, forever" gesture.
export function BulkAddModal({ companyId, employees, currentPeriod, onClose, onChanged }: BulkAddModalProps) {
  const t = useTranslations('hr.payroll.recurringPage.bulk');
  const tCode = useTranslations('hr.payroll.recurringModal');

  const [kind, setKind] = useState<'earning' | 'deduction'>('earning');
  const [code, setCode] = useState<string>(RECURRING_EARNING_CODES[0]);
  const [label, setLabel] = useState('');
  const [amountBaht, setAmountBaht] = useState('');
  const [startPeriod, setStartPeriod] = useState(currentPeriod);
  const [endPeriod, setEndPeriod] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const codes = kind === 'earning' ? RECURRING_EARNING_CODES : RECURRING_DEDUCTION_CODES;

  const setKindSafe = (k: 'earning' | 'deduction') => {
    setKind(k);
    const list = k === 'earning' ? RECURRING_EARNING_CODES : RECURRING_DEDUCTION_CODES;
    if (!(list as readonly string[]).includes(code)) setCode(list[0]);
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => e.name.toLowerCase().includes(q) || (e.position ?? '').toLowerCase().includes(q));
  }, [employees, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allVisibleSelected = visible.length > 0 && visible.every((e) => selected.has(e.id));
  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((e) => next.delete(e.id));
      else visible.forEach((e) => next.add(e.id));
      return next;
    });
  };

  const save = useCallback(async () => {
    const amt = Number(amountBaht);
    if (!label.trim() || !Number.isFinite(amt) || amt <= 0 || selected.size === 0) {
      toast({ type: 'warning', title: t('invalid') });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/hr/payroll/recurring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          employee_ids: Array.from(selected),
          kind, code, label: label.trim(), amount_satang: bahtToSatang(amt),
          start_period: startPeriod || null, end_period: endPeriod || null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast({ type: 'error', title: (json as { error?: string }).error || t('failed') });
        return;
      }
      toast({ type: 'success', title: t('saved', { count: selected.size }) });
      await onChanged();
      onClose();
    } catch {
      toast({ type: 'error', title: t('failed') });
    } finally {
      setSaving(false);
    }
  }, [amountBaht, label, selected, companyId, kind, code, startPeriod, endPeriod, onChanged, onClose, t]);

  return (
    <Modal isOpen onClose={onClose} title={t('title')} size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select value={kind} onChange={(e) => setKindSafe(e.target.value as 'earning' | 'deduction')} className={inputCls}>
            <option value="earning">{tCode('earning')}</option>
            <option value="deduction">{tCode('deduction')}</option>
          </select>
          <select value={code} onChange={(e) => setCode(e.target.value)} className={inputCls}>
            {codes.map((c) => (
              <option key={c} value={c}>{tCode(`code.${c}`)}</option>
            ))}
          </select>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('labelPlaceholder')} className={cn('col-span-2 sm:col-span-1', inputCls)} />
          <div className="flex items-center gap-1.5">
            <input
              type="number" inputMode="decimal" min={0} step={0.01} value={amountBaht}
              onChange={(e) => setAmountBaht(e.target.value)} placeholder="0.00" className={cn('w-full', inputCls)}
            />
            <span className="text-sm text-gray-500">฿</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            {t('startPeriod')}
            <input type="month" value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            {t('endPeriod')}
            <input type="month" value={endPeriod} onChange={(e) => setEndPeriod(e.target.value)} min={startPeriod || undefined} className={inputCls} />
          </label>
        </div>
        <p className="text-[11px] text-gray-400">{t('endHint')}</p>

        {/* employee picker */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 border-b border-gray-200 p-2 dark:border-gray-700">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')} className={cn('w-full pl-8', inputCls)}
              />
            </div>
            <button onClick={toggleAllVisible} className="whitespace-nowrap text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              {allVisibleSelected ? t('unselectAll') : t('selectAll')}
            </button>
          </div>
          <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-700/60">
            {visible.map((e) => (
              <li key={e.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} className="rounded border-gray-300" />
                  <span className="text-gray-900 dark:text-white">{e.name}</span>
                  {e.position && <span className="text-xs text-gray-400">{e.position}</span>}
                </label>
              </li>
            ))}
            {visible.length === 0 && <li className="px-3 py-4 text-center text-sm text-gray-400">{t('noMatch')}</li>}
          </ul>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('selectedCount', { count: selected.size })}</p>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
        <Button onClick={save} isLoading={saving} disabled={selected.size === 0}>
          {t('save', { count: selected.size })}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
