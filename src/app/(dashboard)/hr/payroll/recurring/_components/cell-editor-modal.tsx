'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import { Button, Modal, ModalFooter, Badge, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { formatBaht, bahtToSatang } from '@/lib/pos/money';
import type { GridEmployee, RecurringItem } from './types';

interface CellEditorModalProps {
  employee: GridEmployee;
  kind: 'earning' | 'deduction';
  code: string;
  currentPeriod: string; // 'YYYY-MM'
  items: RecurringItem[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

function windowText(it: RecurringItem, t: (k: string) => string): string {
  if (!it.start_period && !it.end_period) return t('perpetual');
  const s = it.start_period ?? '…';
  const e = it.end_period ?? t('perpetualShort');
  return `${s} → ${e}`;
}

// Editor for ONE employee × ONE item code: list every row (incl. ended), edit amount/window
// in place, end-this-month, delete. Changes apply from the next generate/recompute.
export function CellEditorModal({ employee, kind, code, currentPeriod, items, onClose, onChanged }: CellEditorModalProps) {
  const t = useTranslations('hr.payroll.recurringPage.editor');
  const tCode = useTranslations('hr.payroll.recurringModal');
  const [busy, setBusy] = useState(false);

  const [label, setLabel] = useState('');
  const [amountBaht, setAmountBaht] = useState('');
  const [startPeriod, setStartPeriod] = useState(currentPeriod);
  const [endPeriod, setEndPeriod] = useState('');

  const api = `/api/hr/employees/${employee.id}/recurring`;

  const run = useCallback(
    async (fn: () => Promise<Response>, okMsg: string) => {
      setBusy(true);
      try {
        const res = await fn();
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          toast({ type: 'error', title: (json as { error?: string }).error || t('failed') });
          return false;
        }
        toast({ type: 'success', title: okMsg });
        await onChanged();
        return true;
      } catch {
        toast({ type: 'error', title: t('failed') });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onChanged, t]
  );

  const add = useCallback(async () => {
    const amt = Number(amountBaht);
    if (!label.trim() || !Number.isFinite(amt) || amt <= 0) {
      toast({ type: 'warning', title: t('invalid') });
      return;
    }
    const ok = await run(
      () =>
        fetch(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind, code, label: label.trim(), amount_satang: bahtToSatang(amt),
            start_period: startPeriod || null, end_period: endPeriod || null,
          }),
        }),
      t('added')
    );
    if (ok) {
      setLabel('');
      setAmountBaht('');
      setEndPeriod('');
    }
  }, [amountBaht, label, kind, code, startPeriod, endPeriod, api, run, t]);

  const patch = useCallback(
    (id: string, body: Record<string, unknown>, okMsg: string) =>
      run(
        () =>
          fetch(`${api}?item_id=${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        okMsg
      ),
    [api, run]
  );

  const editAmount = useCallback(
    async (it: RecurringItem) => {
      const raw = window.prompt(t('amountPrompt'), (it.amount_satang / 100).toFixed(2));
      if (raw === null) return;
      const amt = Number(raw);
      if (!Number.isFinite(amt) || amt <= 0) {
        toast({ type: 'warning', title: t('invalid') });
        return;
      }
      await patch(it.id, { amount_satang: bahtToSatang(amt) }, t('updated'));
    },
    [patch, t]
  );

  const endNow = useCallback(
    (it: RecurringItem) => patch(it.id, { end_period: currentPeriod }, t('endedNow')),
    [patch, currentPeriod, t]
  );

  const remove = useCallback(
    async (it: RecurringItem) => {
      if (!window.confirm(t('deleteConfirm'))) return;
      await run(() => fetch(`${api}?item_id=${it.id}`, { method: 'DELETE' }), t('removed'));
    },
    [api, run, t]
  );

  const isLive = (it: RecurringItem) =>
    it.active && (!it.start_period || it.start_period <= currentPeriod) && (!it.end_period || it.end_period >= currentPeriod);

  return (
    <Modal isOpen onClose={onClose} title={`${tCode(`code.${code}`)} · ${employee.name}`} size="md">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Badge variant={kind === 'earning' ? 'success' : 'danger'} size="sm">
            {kind === 'earning' ? tCode('earning') : tCode('deduction')}
          </Badge>
          <span>{t('applyNote')}</span>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-gray-400">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {items.map((it) => (
              <li key={it.id} className={cn('flex items-center justify-between gap-2 py-2 text-sm', !isLive(it) && 'opacity-50')}>
                <div className="min-w-0">
                  <div className="truncate text-gray-900 dark:text-white">{it.label}</div>
                  <div className={cn('text-[11px]', it.end_period ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400')}>
                    {windowText(it, t)}
                    {!it.active && ` · ${t('inactive')}`}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => editAmount(it)}
                    className="rounded px-1.5 py-0.5 tabular-nums text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-gray-200 dark:hover:bg-indigo-900/20"
                    title={t('editAmount')}
                  >
                    {formatBaht(it.amount_satang)} ฿
                  </button>
                  {isLive(it) && (
                    <button
                      onClick={() => endNow(it)}
                      title={t('endThisMonth')}
                      className="rounded p-1 text-gray-400 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/20"
                    >
                      <CalendarOff className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => remove(it)}
                    title={t('delete')}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* add */}
        <div className="space-y-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-600">
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('labelPlaceholder')} className={cn('w-full', inputCls)} />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
              {t('startPeriod')}
              <input type="month" value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-gray-400">
              {t('endPeriod')}
              <input type="month" value={endPeriod} onChange={(e) => setEndPeriod(e.target.value)} min={startPeriod || undefined} className={inputCls} placeholder="" />
            </label>
          </div>
          <p className="text-[11px] text-gray-400">{t('endHint')}</p>
          <div className="flex items-center gap-2">
            <input
              type="number" inputMode="decimal" min={0} step={0.01} value={amountBaht}
              onChange={(e) => setAmountBaht(e.target.value)} placeholder="0.00" className={cn('w-32', inputCls)}
            />
            <span className="text-sm text-gray-500">฿</span>
            <Button size="sm" onClick={add} isLoading={busy} icon={<Plus className="h-4 w-4" />}>{t('add')}</Button>
          </div>
        </div>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>{t('close')}</Button>
      </ModalFooter>
    </Modal>
  );
}
