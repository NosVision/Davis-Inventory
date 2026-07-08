'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Inbox } from 'lucide-react';
import { Button, Select, Tabs, PageHeader, DataList, DataCard, StatusBadge, SkeletonList, ViewToggle, useViewMode, toast } from '@/components/ui';
import { formatThaiDate, formatThaiDateTime } from '@/lib/utils/format';

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

const STATUS_TONE: Record<Status, 'warn' | 'good' | 'critical' | 'neutral'> = {
  pending: 'warn',
  approved: 'good',
  rejected: 'critical',
  cancelled: 'neutral',
};
const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'cancelled'] as const;

export default function HrRequestsPage() {
  const t = useTranslations('hr');
  const tOt = useTranslations('hr.otRequests');
  const tAtt = useTranslations('hr.attendanceRequests');

  const [tab, setTab] = useState<'ot' | 'attendance'>('ot');
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [status, setStatus] = useState<string>('pending');
  const [view, setView] = useViewMode('hr-requests');

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
      <div className="flex w-full flex-wrap items-center gap-2">
        <input
          type="text"
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder={tOt('decisionNote')}
          className="control flex-1"
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
      <>
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
      </>
    ));

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeader
        title={t('nav.requests')}
        subtitle={tab === 'ot' ? tOt('hrSubtitle') : tAtt('hrSubtitle')}
        actions={<ViewToggle value={view} onChange={setView} />}
      />

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
        <SkeletonList rows={5} />
      ) : tab === 'ot' ? (
        otRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
            <Inbox className="h-8 w-8" />
            {tOt('noRequests')}
          </div>
        ) : (
          <DataList compact={view === 'compact'}>
            {otRows.map((r) => (
              <DataCard
                key={r.id}
                accent={STATUS_TONE[r.status]}
                title={`${r.requester_name} · ${formatThaiDate(r.work_date)}`}
                status={<StatusBadge tone={STATUS_TONE[r.status]} label={statusLabel(r.status)} />}
                actions={renderDecideBar(r.id, r.status)}
              >
                <p>
                  {tOt('requestedOt')}: {r.requested_ot_min} {tOt('minutesSuffix')}
                </p>
                <p>{r.reason}</p>
              </DataCard>
            ))}
          </DataList>
        )
      ) : attRows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
          <Inbox className="h-8 w-8" />
          {tAtt('noRequests')}
        </div>
      ) : (
        <DataList compact={view === 'compact'}>
          {attRows.map((r) => (
            <DataCard
              key={r.id}
              accent={STATUS_TONE[r.status]}
              title={`${r.requester_name} · ${formatThaiDate(r.business_date)} · ${kindLabel(r.kind)}`}
              status={
                <>
                  <StatusBadge tone={STATUS_TONE[r.status]} label={statusLabel(r.status)} />
                  {r.status === 'approved' && (
                    <StatusBadge
                      tone={r.applied ? 'good' : 'warn'}
                      label={r.applied ? tAtt('applied') : tAtt('notApplied')}
                    />
                  )}
                </>
              }
              actions={renderDecideBar(r.id, r.status)}
            >
              {r.proposed_ts && (
                <p>
                  {r.proposed_type ? `${r.proposed_type} · ` : ''}
                  {formatThaiDateTime(r.proposed_ts)}
                </p>
              )}
              <p>{r.reason}</p>
            </DataCard>
          ))}
        </DataList>
      )}
    </div>
  );
}
