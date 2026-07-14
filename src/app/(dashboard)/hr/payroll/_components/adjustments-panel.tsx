'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ClipboardPaste, Loader2, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Button, Badge, toast, useConfirm } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { formatBaht, bahtToSatang } from '@/lib/pos/money';

export interface AdjustmentRow {
  id: string;
  profile_id: string;
  kind: 'earning' | 'deduction';
  label: string;
  amount_satang: number;
  reason: string;
  created_at: string;
}
export interface AdjustmentsPrevious {
  id: string;
  period_year: number;
  period_month: number;
  count: number;
}

interface SlipRef {
  user_id: string;
  name: string;
}
interface AdjustmentsPanelProps {
  payrunId: string;
  isDraft: boolean;
  slips: SlipRef[];
  /** silent recompute after any change — the engine must fold adjustments into gross/tax/net */
  onChanged: () => Promise<void> | void;
}

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

// รายการเฉพาะงวด — one-off attributed earning/deduction lines on a draft payrun (the legacy
// Payment file's manual "Other" column, now typed + reasoned + audited). Supersedes BonusBox:
// an earning adjustment is the new bonus. Read-only once finalized.
export function AdjustmentsPanel({ payrunId, isDraft, slips, onChanged }: AdjustmentsPanelProps) {
  const t = useTranslations('hr.payroll.adjustments');
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [rows, setRows] = useState<AdjustmentRow[]>([]);
  const [previous, setPrevious] = useState<AdjustmentsPrevious | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [profileId, setProfileId] = useState('');
  const [kind, setKind] = useState<'earning' | 'deduction'>('deduction');
  const [label, setLabel] = useState('');
  const [amountBaht, setAmountBaht] = useState('');
  const [reason, setReason] = useState('');

  const nameByProfile = new Map(slips.map((s) => [s.user_id, s.name]));

  // Monotonic sequence: a slow response for a previous payrun must never overwrite the state of
  // the currently-selected one (rapid payrun switching keeps this component mounted).
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/payruns/${payrunId}/adjustments`);
      const json = await res.json();
      if (seq !== loadSeq.current) return; // superseded by a newer load
      if (res.ok) {
        setRows((json.data?.adjustments ?? []) as AdjustmentRow[]);
        setPrevious((json.data?.previous ?? null) as AdjustmentsPrevious | null);
      } else {
        setRows([]);
        setPrevious(null);
      }
    } catch {
      if (seq !== loadSeq.current) return;
      setRows([]);
      setPrevious(null);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [payrunId]);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(async () => {
    const amt = Number(amountBaht);
    if (!profileId || !label.trim() || !reason.trim() || !Number.isFinite(amt) || amt <= 0) {
      toast({ type: 'warning', title: t('invalid') });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/payruns/${payrunId}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: profileId, kind, label: label.trim(),
          amount_satang: bahtToSatang(amt), reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast({ type: 'error', title: (json as { error?: string }).error || t('failed') });
        return;
      }
      toast({ type: 'success', title: t('added') });
      setLabel('');
      setAmountBaht('');
      setReason('');
      await load();
      await onChanged();
    } catch {
      toast({ type: 'error', title: t('failed') });
    } finally {
      setBusy(false);
    }
  }, [payrunId, profileId, kind, label, amountBaht, reason, t, load, onChanged]);

  const remove = useCallback(
    async (row: AdjustmentRow) => {
      const ok = await confirm({
        title: t('remove'),
        message: t('deleteConfirm'),
        tone: 'danger',
        confirmLabel: t('remove'),
        cancelLabel: t('cancel'),
      });
      if (!ok) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/hr/payruns/${payrunId}/adjustments?adjustment_id=${row.id}`, { method: 'DELETE' });
        if (!res.ok) {
          toast({ type: 'error', title: t('failed') });
          return;
        }
        toast({ type: 'success', title: t('removed') });
        await load();
        await onChanged();
      } catch {
        toast({ type: 'error', title: t('failed') });
      } finally {
        setBusy(false);
      }
    },
    [payrunId, t, confirm, load, onChanged]
  );

  const copyFromPrevious = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/payruns/${payrunId}/adjustments/copy-from-previous`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ type: 'error', title: (json as { error?: string }).error || t('failed') });
        return;
      }
      const copied = (json as { data?: { copied?: number } }).data?.copied ?? 0;
      toast({ type: copied > 0 ? 'success' : 'info', title: t('copied', { n: copied }) });
      await load();
      if (copied > 0) await onChanged();
    } catch {
      toast({ type: 'error', title: t('failed') });
    } finally {
      setBusy(false);
    }
  }, [payrunId, t, load, onChanged]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex justify-center py-3 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-100">
          <SlidersHorizontal className="h-4 w-4 text-indigo-500" /> {t('title')} ({rows.length})
        </h3>
        {isDraft && previous && previous.count > 0 && (
          <Button size="sm" variant="ghost" onClick={copyFromPrevious} disabled={busy} icon={<ClipboardPaste className="h-4 w-4" />}>
            {t('copyFromPrevious', { n: previous.count })}
          </Button>
        )}
      </div>
      <p className="mb-2 text-xs text-gray-400">{t('hint')}</p>

      {rows.length > 0 && (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="text-left text-xs font-medium text-gray-500 dark:text-gray-400">
              <tr>
                <th className="py-1 pr-2">{t('colEmployee')}</th>
                <th className="py-1 pr-2">{t('colItem')}</th>
                <th className="py-1 pr-2 text-right">{t('colAmount')}</th>
                <th className="py-1 pr-2">{t('colReason')}</th>
                {isDraft && <th className="py-1" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-2 text-gray-900 dark:text-white">{nameByProfile.get(r.profile_id) ?? '—'}</td>
                  <td className="py-1.5 pr-2">
                    <Badge variant={r.kind === 'earning' ? 'success' : 'danger'} size="sm">
                      {r.kind === 'earning' ? t('earning') : t('deduction')}
                    </Badge>
                    <span className="ml-1.5 text-gray-700 dark:text-gray-200">{r.label}</span>
                  </td>
                  <td className={cn('py-1.5 pr-2 text-right tabular-nums', r.kind === 'deduction' && 'text-red-600 dark:text-red-400')}>
                    {r.kind === 'deduction' ? '−' : '+'}{formatBaht(r.amount_satang)}
                  </td>
                  <td className="max-w-[16rem] truncate py-1.5 pr-2 text-xs text-gray-500 dark:text-gray-400" title={r.reason}>
                    {r.reason}
                  </td>
                  {isDraft && (
                    <td className="py-1.5 text-right">
                      <button
                        onClick={() => remove(r)}
                        title={t('remove')}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isDraft && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-dashed border-gray-300 p-3 sm:grid-cols-6 dark:border-gray-600">
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className={inputCls}>
            <option value="">{t('pickEmployee')}</option>
            {slips.map((s) => (
              <option key={s.user_id} value={s.user_id}>{s.name}</option>
            ))}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'earning' | 'deduction')} className={inputCls}>
            <option value="deduction">{t('deduction')}</option>
            <option value="earning">{t('earning')}</option>
          </select>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('labelPlaceholder')} className={inputCls} />
          <input
            type="number" inputMode="decimal" min={0} step={0.01} value={amountBaht}
            onChange={(e) => setAmountBaht(e.target.value)} placeholder="0.00" className={inputCls}
          />
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('reasonPlaceholder')} className={inputCls} />
          <Button size="sm" onClick={add} isLoading={busy} icon={<Plus className="h-4 w-4" />}>{t('add')}</Button>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
