'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Inbox } from 'lucide-react';
import { Button, Badge, Select, Tabs, toast } from '@/components/ui';

interface StoreOpt {
  id: string;
  store_code: string;
  store_name: string;
}
type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';
type Kind = 'missing_in' | 'missing_out' | 'wrong_time' | 'other';

interface OtRow {
  id: string;
  requester_name: string | null;
  work_date: string;
  requested_ot_min: number;
  decided_ot_min: number | null;
  reason: string;
  status: Status;
}
interface AttRow {
  id: string;
  requester_name: string | null;
  business_date: string;
  kind: Kind;
  proposed_type: string | null;
  proposed_ts: string | null;
  reason: string;
  status: Status;
  applied: boolean;
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

export default function HrRequestsPage() {
  const t = useTranslations('hr');
  const tOt = useTranslations('hr.otRequests');
  const tAtt = useTranslations('hr.attendanceRequests');

  const [tab, setTab] = useState<'ot' | 'attendance'>('ot');
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [status, setStatus] = useState<string>('pending');

  const [otRows, setOtRows] = useState<OtRow[]>([]);
  const [attRows, setAttRows] = useState<AttRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const statusLabel = useCallback(
    (s: Status) =>
      s === 'pending'
        ? tOt('statusPending')
        : s === 'approved'
          ? tOt('statusApproved')
          : s === 'rejected'
            ? tOt('statusRejected')
            : tOt('statusCancelled'),
    [tOt]
  );
  const kindLabel = useCallback(
    (k: Kind) =>
      k === 'missing_in'
        ? tAtt('kindMissingIn')
        : k === 'missing_out'
          ? tAtt('kindMissingOut')
          : k === 'wrong_time'
            ? tAtt('kindWrongTime')
            : tAtt('kindOther'),
    [tAtt]
  );

  // manageable stores
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/manageable-stores');
        const json = await res.json();
        const list = (json.data ?? []) as StoreOpt[];
        setStores(list);
        setStoreId((prev) => prev || list[0]?.id || '');
      } catch {
        setStores([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!storeId) {
      setOtRows([]);
      setAttRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ store_id: storeId });
      if (status !== 'all') params.set('status', status);
      const path = tab === 'ot' ? 'ot-requests' : 'attendance-requests';
      const res = await fetch(`/api/hr/${path}?${params.toString()}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      if (tab === 'ot') setOtRows((json.data ?? []) as OtRow[]);
      else setAttRows((json.data ?? []) as AttRow[]);
    } catch {
      if (tab === 'ot') setOtRows([]);
      else setAttRows([]);
    } finally {
      setLoading(false);
      setRejectId(null);
      setRejectNote('');
    }
  }, [storeId, status, tab]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = useCallback(
    async (id: string, decision: 'approved' | 'rejected', note?: string) => {
      try {
        const path = tab === 'ot' ? 'ot-requests' : 'attendance-requests';
        const res = await fetch(`/api/hr/${path}/${id}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, note: note?.trim() || undefined }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || json?.message);
        toast({
          type: 'success',
          title: decision === 'approved' ? tOt('approved') : tOt('rejected'),
        });
        // The approval may have succeeded while its side-effect apply failed — surface it.
        if (json?.warning) toast({ type: 'warning', title: json.warning });
        await load();
      } catch {
        toast({ type: 'error', title: tOt('actionFailed') });
      }
    },
    [tab, tOt, load]
  );

  const storeOptions = stores.map((s) => ({ value: s.id, label: s.store_name }));
  const statusOptions = STATUS_FILTERS.map((s) => ({
    value: s,
    label: s === 'all' ? tOt('statusAll') : statusLabel(s as Status),
  }));

  const renderDecideBar = (id: string, s: Status) =>
    s === 'pending' &&
    (rejectId === id ? (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder={tOt('decisionNote')}
          className={`flex-1 ${inputCls}`}
        />
        <Button size="sm" variant="danger" onClick={() => decide(id, 'rejected', rejectNote)}>
          {tOt('reject')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setRejectId(null);
            setRejectNote('');
          }}
        >
          {tOt('cancel')}
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
          {tOt('reject')}
        </Button>
        <Button size="sm" onClick={() => decide(id, 'approved')}>
          {tOt('approve')}
        </Button>
      </div>
    ));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('nav.requests')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {tab === 'ot' ? tOt('hrSubtitle') : tAtt('hrSubtitle')}
        </p>
      </div>

      <Tabs
        tabs={[
          { id: 'ot', label: tOt('title') },
          { id: 'attendance', label: tAtt('title') },
        ]}
        activeTab={tab}
        onChange={(id) => setTab(id as 'ot' | 'attendance')}
      />

      {/* filters */}
      <div className="grid grid-cols-2 gap-3">
        <Select
          label={tOt('storeLabel')}
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          options={storeOptions}
        />
        <Select
          label={tOt('status')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={statusOptions}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : tab === 'ot' ? (
        otRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
            <Inbox className="h-8 w-8" />
            {tOt('noRequests')}
          </div>
        ) : (
          <ul className="space-y-2">
            {otRows.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {r.requester_name} · {r.work_date}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {tOt('requestedOt')}: {r.requested_ot_min} {tOt('minutesSuffix')}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{r.reason}</p>
                  </div>
                  <Badge variant={STATUS_VARIANT[r.status]} size="sm">
                    {statusLabel(r.status)}
                  </Badge>
                </div>
                {renderDecideBar(r.id, r.status)}
              </li>
            ))}
          </ul>
        )
      ) : attRows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
          <Inbox className="h-8 w-8" />
          {tAtt('noRequests')}
        </div>
      ) : (
        <ul className="space-y-2">
          {attRows.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {r.requester_name} · {r.business_date} · {kindLabel(r.kind)}
                  </p>
                  {r.proposed_ts && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {r.proposed_type ? `${r.proposed_type} · ` : ''}
                      {new Date(r.proposed_ts).toLocaleString()}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400">{r.reason}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={STATUS_VARIANT[r.status]} size="sm">
                    {statusLabel(r.status)}
                  </Badge>
                  {r.status === 'approved' && (
                    <Badge variant={r.applied ? 'success' : 'warning'} size="sm">
                      {r.applied ? tAtt('applied') : tAtt('notApplied')}
                    </Badge>
                  )}
                </div>
              </div>
              {renderDecideBar(r.id, r.status)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
