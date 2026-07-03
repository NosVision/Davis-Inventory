'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Inbox } from 'lucide-react';
import { Button, Badge, Select, toast } from '@/components/ui';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';
type FieldKey = 'bank_account' | 'emergency_contact';

interface ChangeRequest {
  id: string;
  field_key: FieldKey;
  current_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  reason: string | null;
  status: Status;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  requester: { id: string; display_name: string | null; username: string | null } | null;
}

const STATUS_VARIANT: Record<Status, 'warning' | 'success' | 'danger' | 'default'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'default',
};
const STATUS_FILTERS = ['pending', 'approved', 'rejected', 'cancelled', 'all'] as const;

const KNOWN_KEYS = [
  'bank_name',
  'bank_account_no',
  'bank_account_name',
  'name',
  'phone',
  'relation',
] as const;

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

export default function HrProfileRequestsPage() {
  const t = useTranslations('hr.profile');

  const [status, setStatus] = useState<string>('pending');
  const [rows, setRows] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

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

  const fieldLabel = useCallback(
    (f: FieldKey) => (f === 'bank_account' ? t('fieldBankAccount') : t('fieldEmergencyContact')),
    [t]
  );

  const keyLabel = useCallback(
    (k: string) =>
      (KNOWN_KEYS as readonly string[]).includes(k) ? t(`key_${k}` as never) : k,
    [t]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = status !== 'all' ? `?status=${status}` : '';
      const res = await fetch(`/api/hr/profile-change-requests${qs}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setRows((json.data ?? []) as ChangeRequest[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
      setRejectId(null);
      setRejectNote('');
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = useCallback(
    async (id: string, decision: 'approved' | 'rejected', note?: string) => {
      try {
        const res = await fetch(`/api/hr/profile-change-requests/${id}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, note: note?.trim() || undefined }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || json?.message);
        toast({
          type: 'success',
          title: decision === 'approved' ? t('approved') : t('rejected'),
        });
        // Decision may have succeeded while applying to the employee record failed.
        if (json?.warning) toast({ type: 'warning', title: t('applyWarning') });
        await load();
      } catch {
        toast({ type: 'error', title: t('actionFailed') });
      }
    },
    [t, load]
  );

  const statusOptions = STATUS_FILTERS.map((s) => ({
    value: s,
    label: s === 'all' ? t('statusAll') : statusLabel(s as Status),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('hrTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('hrSubtitle')}</p>
      </div>

      <div className="max-w-xs">
        <Select
          label={t('status')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={statusOptions}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
          <Inbox className="h-8 w-8" />
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
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {r.requester?.display_name ?? r.requester?.username ?? '—'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{fieldLabel(r.field_key)}</p>
                </div>
                <Badge variant={STATUS_VARIANT[r.status]} size="sm">
                  {statusLabel(r.status)}
                </Badge>
              </div>

              <div className="mt-2">
                <ValueDiff
                  current={r.current_value}
                  next={r.new_value}
                  keyLabel={keyLabel}
                  currentLabel={t('currentLabel')}
                  newLabel={t('newLabel')}
                  emptyLabel={t('emptyValue')}
                />
              </div>

              {r.reason && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {t('reason')}: {r.reason}
                </p>
              )}
              {r.decision_note && (
                <p className="mt-1 text-xs text-gray-400">
                  {t('decisionNote')}: {r.decision_note}
                </p>
              )}

              {r.status === 'pending' &&
                (rejectId === r.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder={t('decisionNote')}
                      className={`flex-1 ${inputCls}`}
                    />
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => decide(r.id, 'rejected', rejectNote)}
                    >
                      {t('reject')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRejectId(null);
                        setRejectNote('');
                      }}
                    >
                      {t('cancel')}
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRejectId(r.id);
                        setRejectNote('');
                      }}
                    >
                      {t('reject')}
                    </Button>
                    <Button size="sm" onClick={() => decide(r.id, 'approved')}>
                      {t('approve')}
                    </Button>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Generic current→new diff. Iterates the union of both objects' keys so it works
// for any field type (bank account, emergency contact, and future ones).
function ValueDiff({
  current,
  next,
  keyLabel,
  currentLabel,
  newLabel,
  emptyLabel,
}: {
  current: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  keyLabel: (k: string) => string;
  currentLabel: string;
  newLabel: string;
  emptyLabel: string;
}) {
  const keys = Array.from(
    new Set([...Object.keys(current ?? {}), ...Object.keys(next ?? {})])
  );
  const fmt = (v: unknown) =>
    v === null || v === undefined || v === '' ? emptyLabel : String(v);

  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="rounded-lg bg-gray-50 p-2 dark:bg-gray-900/40">
        <p className="mb-1 text-[10px] font-semibold uppercase text-gray-400">{currentLabel}</p>
        {keys.map((k) => (
          <p key={k} className="text-gray-500 dark:text-gray-400">
            <span className="text-gray-400">{keyLabel(k)}:</span> {fmt((current ?? {})[k])}
          </p>
        ))}
      </div>
      <div className="rounded-lg bg-indigo-50 p-2 dark:bg-indigo-900/20">
        <p className="mb-1 text-[10px] font-semibold uppercase text-indigo-400">{newLabel}</p>
        {keys.map((k) => (
          <p key={k} className="text-gray-700 dark:text-gray-200">
            <span className="text-gray-400">{keyLabel(k)}:</span> {fmt((next ?? {})[k])}
          </p>
        ))}
      </div>
    </div>
  );
}
