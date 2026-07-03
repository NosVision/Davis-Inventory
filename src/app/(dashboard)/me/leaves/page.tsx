'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, CalendarOff, Send } from 'lucide-react';
import { Button, Badge, toast } from '@/components/ui';
import { todayBangkok } from '@/lib/utils/date';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface LeaveType {
  id: string;
  code: string;
  name_th: string;
  name_en: string;
  requires_cert: boolean;
  advance_notice_days: number;
  probational_allowed: boolean;
  paid: boolean;
}

interface LeaveRow {
  id: string;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  days: number;
  reason: string;
  cert_path: string | null;
  status: Status;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  leave_type: { code: string; name_th: string; name_en: string } | null;
}

const STATUS_VARIANT: Record<Status, 'warning' | 'success' | 'danger' | 'default'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'default',
};

const inputCls =
  'mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

// Inclusive day count between two YYYY-MM-DD strings; 0 when invalid.
function inclusiveDays(from: string, to: string): number {
  if (!from || !to) return 0;
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || t < f) return 0;
  return Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
}

export default function MyLeavesPage() {
  const t = useTranslations('hr.leaves');

  const [types, setTypes] = useState<LeaveType[]>([]);
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const today = todayBangkok();
  const [typeId, setTypeId] = useState('');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [reason, setReason] = useState('');
  const [cert, setCert] = useState<File | null>(null);

  const statusLabel = useCallback(
    (s: Status) =>
      s === 'pending'
        ? t('statusPending')
        : s === 'approved'
          ? t('statusApproved')
          : s === 'rejected'
            ? t('statusRejected')
            : t('statusCancelled'),
    [t]
  );

  const selectedType = useMemo(
    () => types.find((ty) => ty.id === typeId) ?? null,
    [types, typeId]
  );
  const requiresCert = Boolean(selectedType?.requires_cert);
  const dayCount = inclusiveDays(fromDate, toDate);

  const fetchTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/ess/leave-types');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      const list = (json.data ?? []) as LeaveType[];
      setTypes(list);
      setTypeId((prev) => prev || list[0]?.id || '');
    } catch {
      setTypes([]);
    }
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/leaves');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setRows((json.data ?? []) as LeaveRow[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTypes();
    fetchRows();
  }, [fetchTypes, fetchRows]);

  const submit = useCallback(async () => {
    if (!typeId || !fromDate || !toDate || !reason.trim() || dayCount <= 0) return;
    if (requiresCert && !cert) {
      toast({ type: 'error', title: t('certRequired') });
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('leave_type_id', typeId);
      fd.append('from_date', fromDate);
      fd.append('to_date', toDate);
      fd.append('reason', reason.trim());
      if (cert) fd.append('cert', cert);
      // NOTE: do not set Content-Type — the browser sets the multipart boundary.
      const res = await fetch('/api/hr/ess/leaves', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || json?.message || t('fileFailed'));
      toast({ type: 'success', title: t('filed') });
      setReason('');
      setCert(null);
      setFromDate(today);
      setToDate(today);
      await fetchRows();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : t('fileFailed') });
    } finally {
      setSubmitting(false);
    }
  }, [typeId, fromDate, toDate, reason, dayCount, requiresCert, cert, t, today, fetchRows]);

  const cancel = useCallback(
    async (id: string) => {
      if (!window.confirm(t('confirmCancel'))) return;
      try {
        const res = await fetch(`/api/hr/ess/leaves/${id}/cancel`, { method: 'POST' });
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
    Boolean(typeId && fromDate && toDate && reason.trim()) &&
    dayCount > 0 &&
    (!requiresCert || Boolean(cert)) &&
    !submitting;

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('mySubtitle')}</p>
      </div>

      {/* File form */}
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t('fileHeading')}</h2>

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('leaveType')}
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            className={inputCls}
          >
            {types.length === 0 && <option value="">{t('noTypes')}</option>}
            {types.map((ty) => (
              <option key={ty.id} value={ty.id}>
                {ty.name_th}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('fromDate')}
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('toDate')}
            <input
              type="date"
              value={toDate}
              min={fromDate}
              onChange={(e) => setToDate(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>

        {dayCount > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('daysPreview', { days: dayCount })}
          </p>
        )}

        <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('reason')}
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputCls}
          />
        </label>

        {requiresCert && (
          <label className="flex flex-col text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('certLabel')}
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setCert(e.target.files?.[0] ?? null)}
              className={`${inputCls} file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-600 dark:file:bg-indigo-900/40 dark:file:text-indigo-300`}
            />
            <span className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              {t('certHint')}
            </span>
          </label>
        )}

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

      {/* My leaves */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
          {t('myLeavesHeading')}
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">
            <CalendarOff className="h-8 w-8" />
            {t('noLeaves')}
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
                      {r.leave_type?.name_th ?? r.leave_type?.name_en ?? '—'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {r.from_date}
                      {r.to_date !== r.from_date && ` → ${r.to_date}`}
                      {' · '}
                      {t('daysPreview', { days: r.days })}
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
