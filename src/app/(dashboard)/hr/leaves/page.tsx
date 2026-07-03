'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Inbox, FileText } from 'lucide-react';
import { Button, Badge, Select, toast } from '@/components/ui';

interface StoreOpt {
  id: string;
  store_code: string;
  store_name: string;
}
type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';

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
  requester: { id: string; display_name: string | null; username: string | null } | null;
  leave_type: { code: string; name_th: string; name_en: string } | null;
}

const STATUS_VARIANT: Record<Status, 'warning' | 'success' | 'danger' | 'default'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'default',
};
const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'cancelled'] as const;

const inputCls =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white';

export default function HrLeavesPage() {
  const t = useTranslations('hr.leaves');

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState(''); // '' = company-wide (no store_id)
  const [status, setStatus] = useState<string>('pending');

  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [certLoadingId, setCertLoadingId] = useState<string | null>(null);

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

  // manageable stores (same source as /hr/requests)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/manageable-stores');
        const json = await res.json();
        setStores((json.data ?? []) as StoreOpt[]);
      } catch {
        setStores([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (storeId) params.set('store_id', storeId);
      if (status !== 'all') params.set('status', status);
      const qs = params.toString();
      const res = await fetch(`/api/hr/leaves${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setRows((json.data ?? []) as LeaveRow[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
      setRejectId(null);
      setRejectNote('');
    }
  }, [storeId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = useCallback(
    async (id: string, decision: 'approved' | 'rejected', note?: string) => {
      try {
        const res = await fetch(`/api/hr/leaves/${id}/decide`, {
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
        // Decision may have succeeded while its balance-apply side-effect warned — surface it.
        if (json?.warning) toast({ type: 'warning', title: json.warning });
        await load();
      } catch {
        toast({ type: 'error', title: t('actionFailed') });
      }
    },
    [t, load]
  );

  const viewCert = useCallback(
    async (id: string) => {
      setCertLoadingId(id);
      try {
        // Store-scoped cert viewer: authorized to whoever may decide this leave
        // (store manager or HR), unlike the HR-only /api/hr/documents endpoint.
        const res = await fetch(`/api/hr/leaves/${id}/cert`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.url) throw new Error();
        window.open(json.url as string, '_blank', 'noopener,noreferrer');
      } catch {
        toast({ type: 'error', title: t('certLoadFailed') });
      } finally {
        setCertLoadingId(null);
      }
    },
    [t]
  );

  const storeOptions = [
    { value: '', label: t('allStores') },
    ...stores.map((s) => ({ value: s.id, label: s.store_name })),
  ];
  const statusOptions = STATUS_FILTERS.map((s) => ({
    value: s,
    label: s === 'all' ? t('statusAll') : statusLabel(s as Status),
  }));

  const renderDecideBar = (id: string, s: Status) =>
    s === 'pending' &&
    (rejectId === id ? (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder={t('decisionNote')}
          className={`flex-1 ${inputCls}`}
        />
        <Button size="sm" variant="danger" onClick={() => decide(id, 'rejected', rejectNote)}>
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
            setRejectId(id);
            setRejectNote('');
          }}
        >
          {t('reject')}
        </Button>
        <Button size="sm" onClick={() => decide(id, 'approved')}>
          {t('approve')}
        </Button>
      </div>
    ));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('hrTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('hrSubtitle')}</p>
      </div>

      {/* filters */}
      <div className="grid grid-cols-2 gap-3">
        <Select
          label={t('storeLabel')}
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          options={storeOptions}
        />
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
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {r.requester?.display_name ?? r.requester?.username ?? '—'}
                    {' · '}
                    {r.leave_type?.name_th ?? r.leave_type?.name_en ?? '—'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {r.from_date}
                    {r.to_date !== r.from_date && ` → ${r.to_date}`}
                    {' · '}
                    {t('daysPreview', { days: r.days })}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{r.reason}</p>
                  {r.cert_path && (
                    <button
                      type="button"
                      onClick={() => viewCert(r.id)}
                      disabled={certLoadingId === r.id}
                      className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline disabled:opacity-60 dark:text-indigo-400"
                    >
                      {certLoadingId === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                      {t('viewCert')}
                    </button>
                  )}
                </div>
                <Badge variant={STATUS_VARIANT[r.status]} size="sm">
                  {statusLabel(r.status)}
                </Badge>
              </div>
              {renderDecideBar(r.id, r.status)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
