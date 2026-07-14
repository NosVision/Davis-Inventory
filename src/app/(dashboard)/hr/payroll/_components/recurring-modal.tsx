'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button, Modal, ModalFooter, Badge, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { formatBaht, bahtToSatang } from '@/lib/pos/money';
import { AdjustmentsPanel } from './adjustments-panel';

interface RecurringItem {
  id: string;
  kind: 'earning' | 'deduction';
  code: string;
  label: string;
  amount_satang: number;
  active: boolean;
}
interface RecurringModalProps {
  employeeId: string;
  name: string;
  onClose: () => void;
  /** fired after any successful add/remove — lets the payroll page auto-recompute on close */
  onChanged?: () => void;
  /** with payrunId + profileId the modal grows a second tab: this employee's one-off
      รายการเฉพาะงวด lines on the open payrun (owner ask 2026-07-15) */
  payrunId?: string;
  profileId?: string;
  isDraft?: boolean;
  /** adjustments recompute immediately (same as the payrun-wide panel) */
  onAdjustChanged?: () => Promise<void> | void;
}

const EARNING_CODES = ['cost_of_living', 'housing', 'phone', 'travel', 'holiday_comp', 'other'];
const DEDUCTION_CODES = ['student_loan', 'advance', 'guarantee', 'loan', 'other'];
const inputCls =
  'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

export function RecurringModal({ employeeId, name, onClose, onChanged, payrunId, profileId, isDraft, onAdjustChanged }: RecurringModalProps) {
  const t = useTranslations('hr.payroll.recurringModal');
  const hasAdjustTab = Boolean(payrunId && profileId);
  const [tab, setTab] = useState<'recurring' | 'adjust'>('recurring');
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [kind, setKind] = useState<'earning' | 'deduction'>('earning');
  const [code, setCode] = useState('cost_of_living');
  const [label, setLabel] = useState('');
  const [amountBaht, setAmountBaht] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/recurring`);
      const json = await res.json();
      setItems((json.data ?? []) as RecurringItem[]);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const codes = kind === 'earning' ? EARNING_CODES : DEDUCTION_CODES;
  // keep code valid when kind flips
  useEffect(() => {
    if (!codes.includes(code)) setCode(codes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const add = useCallback(async () => {
    const amt = Number(amountBaht);
    if (!label.trim() || !Number.isFinite(amt) || amt <= 0) {
      toast({ type: 'warning', title: t('invalid') });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/recurring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, code, label: label.trim(), amount_satang: bahtToSatang(amt) }),
      });
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed') });
        return;
      }
      toast({ type: 'success', title: t('added') });
      setLabel('');
      setAmountBaht('');
      onChanged?.();
      await load();
    } finally {
      setSaving(false);
    }
  }, [amountBaht, label, kind, code, employeeId, t, load, onChanged]);

  const remove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/recurring?item_id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed') });
        return;
      }
      toast({ type: 'success', title: t('removed') });
      onChanged?.();
      await load();
    } catch {
      toast({ type: 'error', title: t('saveFailed') });
    }
  }, [employeeId, t, load, onChanged]);

  const tabBtn = (key: 'recurring' | 'adjust', label: string) => (
    <button
      onClick={() => setTab(key)}
      className={cn(
        'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        tab === key
          ? 'bg-white text-indigo-700 shadow-sm dark:bg-gray-800 dark:text-indigo-300'
          : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
      )}
    >
      {label}
    </button>
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${hasAdjustTab ? t('combinedTitle') : t('title')} · ${name}`}
      size={hasAdjustTab ? 'full' : 'md'}
    >
      {hasAdjustTab && (
        <div className="mb-3 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-700/50">
          {tabBtn('recurring', t('tabRecurring'))}
          {tabBtn('adjust', t('tabAdjust'))}
        </div>
      )}

      {hasAdjustTab && tab === 'adjust' ? (
        <AdjustmentsPanel
          payrunId={payrunId as string}
          isDraft={!!isDraft}
          slips={[{ user_id: profileId as string, name }]}
          fixedProfile={{ user_id: profileId as string, name }}
          onChanged={onAdjustChanged ?? (() => {})}
        />
      ) : (
      <div className="space-y-3">
        <p className="text-xs text-gray-400">{t('applyNote')}</p>
        {loading ? (
          <div className="flex justify-center py-6 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-400">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={it.kind === 'earning' ? 'success' : 'danger'} size="sm">
                    {it.kind === 'earning' ? t('earning') : t('deduction')}
                  </Badge>
                  <span className="text-gray-900 dark:text-white">{it.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-gray-700 dark:text-gray-200">{formatBaht(it.amount_satang)} ฿</span>
                  <button onClick={() => remove(it.id)} aria-label={t('remove')} title={t('remove')} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* add form */}
        <div className="space-y-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-600">
          <div className="grid grid-cols-2 gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value as 'earning' | 'deduction')} className={inputCls}>
              <option value="earning">{t('earning')}</option>
              <option value="deduction">{t('deduction')}</option>
            </select>
            <select value={code} onChange={(e) => setCode(e.target.value)} className={inputCls}>
              {codes.map((c) => (
                <option key={c} value={c}>{t(`code.${c}`)}</option>
              ))}
            </select>
          </div>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('labelPlaceholder')} className={cn('w-full', inputCls)} />
          <div className="flex items-center gap-2">
            <input type="number" inputMode="decimal" min={0} step={0.01} value={amountBaht} onChange={(e) => setAmountBaht(e.target.value)} placeholder="0.00" className={cn('w-32', inputCls)} />
            <span className="text-sm text-gray-500">฿</span>
            <Button size="sm" onClick={add} isLoading={saving} icon={<Plus className="h-4 w-4" />}>{t('add')}</Button>
          </div>
        </div>
      </div>
      )}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>{t('close')}</Button>
      </ModalFooter>
    </Modal>
  );
}
