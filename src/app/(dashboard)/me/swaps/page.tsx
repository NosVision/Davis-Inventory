'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ArrowLeftRight, Send } from 'lucide-react';
import { Button, Badge, toast } from '@/components/ui';

interface Coworker {
  user_id: string;
  name: string;
}
interface Swap {
  id: string;
  role: 'requester' | 'counterpart';
  requester_name: string;
  counterpart_name: string;
  requester_date: string;
  counterpart_date: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  note: string | null;
  created_at: string;
}

const STATUS_VARIANT: Record<Swap['status'], 'warning' | 'success' | 'danger' | 'default'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'default',
};

const inputCls =
  'mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

export default function MySwapsPage() {
  const t = useTranslations('hr.swaps');

  const [coworkers, setCoworkers] = useState<Coworker[]>([]);
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [myDate, setMyDate] = useState('');
  const [counterpartId, setCounterpartId] = useState('');
  const [theirDate, setTheirDate] = useState('');
  const [note, setNote] = useState('');

  const statusLabel = useCallback(
    (s: Swap['status']) =>
      s === 'pending'
        ? t('statusPending')
        : s === 'approved'
          ? t('statusApproved')
          : s === 'rejected'
            ? t('statusRejected')
            : t('statusCancelled'),
    [t]
  );

  const fetchSwaps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/dayoff-swaps');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setSwaps((json.data ?? []) as Swap[]);
    } catch {
      setSwaps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/ess/coworkers');
        const json = await res.json();
        setCoworkers((json.data ?? []) as Coworker[]);
      } catch {
        setCoworkers([]);
      }
    })();
    fetchSwaps();
  }, [fetchSwaps]);

  const submit = useCallback(async () => {
    if (!myDate || !counterpartId || !theirDate) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/hr/ess/dayoff-swaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          counterpart_id: counterpartId,
          requester_date: myDate,
          counterpart_date: theirDate,
          note: note.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || json?.message || t('fileFailed'));
      toast({ type: 'success', title: t('filed') });
      setMyDate('');
      setCounterpartId('');
      setTheirDate('');
      setNote('');
      await fetchSwaps();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : t('fileFailed') });
    } finally {
      setSubmitting(false);
    }
  }, [myDate, counterpartId, theirDate, note, t, fetchSwaps]);

  const cancelSwap = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/hr/ess/dayoff-swaps/${id}/cancel`, { method: 'POST' });
        if (!res.ok) throw new Error();
        toast({ type: 'success', title: t('cancelled') });
        await fetchSwaps();
      } catch {
        toast({ type: 'error', title: t('actionFailed') });
      }
    },
    [t, fetchSwaps]
  );

  const canSubmit = Boolean(myDate && counterpartId && theirDate) && !submitting;

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('mySubtitle')}</p>
      </div>

      {/* File form */}
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t('fileHeading')}</h2>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('myDate')}
            <input
              type="date"
              value={myDate}
              onChange={(e) => setMyDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('theirDate')}
            <input
              type="date"
              value={theirDate}
              onChange={(e) => setTheirDate(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('counterpart')}
          <select
            value={counterpartId}
            onChange={(e) => setCounterpartId(e.target.value)}
            className={inputCls}
          >
            <option value="">—</option>
            {coworkers.map((c) => (
              <option key={c.user_id} value={c.user_id}>
                {c.name}
              </option>
            ))}
          </select>
          {coworkers.length === 0 && (
            <span className="mt-1 text-[11px] text-gray-400">{t('noCoworkers')}</span>
          )}
        </label>

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('note')}
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={inputCls}
          />
        </label>

        <Button
          size="sm"
          onClick={submit}
          isLoading={submitting}
          disabled={!canSubmit}
          icon={<Send className="h-4 w-4" />}
        >
          {t('submit')}
        </Button>
      </div>

      {/* My swaps */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
          {t('mySwapsHeading')}
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : swaps.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
            <ArrowLeftRight className="h-8 w-8" />
            {t('noSwaps')}
          </div>
        ) : (
          <ul className="space-y-2">
            {swaps.map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {s.requester_name} ({s.requester_date}){' '}
                    <ArrowLeftRight className="inline h-3.5 w-3.5 align-middle text-gray-400" />{' '}
                    {s.counterpart_name} ({s.counterpart_date})
                  </p>
                  <Badge variant={STATUS_VARIANT[s.status]} size="sm">
                    {statusLabel(s.status)}
                  </Badge>
                </div>
                {s.note && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{s.note}</p>
                )}
                {s.role === 'requester' && s.status === 'pending' && (
                  <div className="mt-2 flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => cancelSwap(s.id)}>
                      {t('cancel')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
