'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Clock, Send } from 'lucide-react';
import { Button, Badge, toast } from '@/components/ui';

interface OtRequest {
  id: string;
  work_date: string;
  requested_ot_min: number;
  decided_ot_min: number | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decision_note: string | null;
  created_at: string;
}

const STATUS_VARIANT: Record<OtRequest['status'], 'warning' | 'success' | 'danger' | 'default'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'default',
};

const inputCls =
  'mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

export default function MyOtRequestsPage() {
  const t = useTranslations('hr.otRequests');

  const [rows, setRows] = useState<OtRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [workDate, setWorkDate] = useState('');
  const [minutes, setMinutes] = useState('');
  const [reason, setReason] = useState('');

  const statusLabel = useCallback(
    (s: OtRequest['status']) =>
      s === 'pending'
        ? t('statusPending')
        : s === 'approved'
          ? t('statusApproved')
          : s === 'rejected'
            ? t('statusRejected')
            : t('statusCancelled'),
    [t]
  );

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/ot-requests');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setRows((json.data ?? []) as OtRequest[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const submit = useCallback(async () => {
    const min = Number(minutes);
    if (!workDate || !Number.isInteger(min) || min <= 0 || !reason.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/hr/ess/ot-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_date: workDate,
          requested_ot_min: min,
          reason: reason.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || json?.message || t('fileFailed'));
      toast({ type: 'success', title: t('filed') });
      setWorkDate('');
      setMinutes('');
      setReason('');
      await fetchRows();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : t('fileFailed') });
    } finally {
      setSubmitting(false);
    }
  }, [workDate, minutes, reason, t, fetchRows]);

  const cancel = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/hr/ess/ot-requests/${id}/cancel`, { method: 'POST' });
        if (!res.ok) throw new Error();
        toast({ type: 'success', title: t('cancelled') });
        await fetchRows();
      } catch {
        toast({ type: 'error', title: t('actionFailed') });
      }
    },
    [t, fetchRows]
  );

  const canSubmit =
    Boolean(workDate && reason.trim()) && Number(minutes) > 0 && !submitting;

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
            {t('workDate')}
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('requestedMinutes')}
            <input
              type="number"
              min={1}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('reason')}
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
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

      {/* My requests */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
          {t('myRequestsHeading')}
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
            <Clock className="h-8 w-8" />
            {t('noRequests')}
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {r.work_date}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t('requestedOt')}: {r.requested_ot_min} {t('minutesSuffix')}
                      {r.status === 'approved' && r.decided_ot_min != null && (
                        <>
                          {' · '}
                          {t('decidedOt')}: {r.decided_ot_min} {t('minutesSuffix')}
                        </>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{r.reason}</p>
                    {r.decision_note && (
                      <p className="text-xs text-gray-400">{r.decision_note}</p>
                    )}
                  </div>
                  <Badge variant={STATUS_VARIANT[r.status]} size="sm">
                    {statusLabel(r.status)}
                  </Badge>
                </div>
                {r.status === 'pending' && (
                  <div className="mt-2 flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => cancel(r.id)}>
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
