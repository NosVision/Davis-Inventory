'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeftRight } from 'lucide-react';
import { Button, Select, PageHeader, DataList, DataCard, StatusBadge, SkeletonList, ViewToggle, useViewMode, toast } from '@/components/ui';
import { EmployeeName } from '@/components/hr/employee-name';

interface StoreOpt {
  id: string;
  store_code: string;
  store_name: string;
}
interface Swap {
  id: string;
  requester_name: string;
  requester_nickname: string | null;
  counterpart_name: string;
  counterpart_nickname: string | null;
  requester_date: string;
  counterpart_date: string;
  requester_assignment: string | null;
  counterpart_assignment: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  note: string | null;
  decided_at: string | null;
  hr_acked_at: string | null;
}

const STATUS_TONE: Record<Swap['status'], 'warn' | 'good' | 'critical' | 'neutral'> = {
  pending: 'warn',
  approved: 'good',
  rejected: 'critical',
  cancelled: 'neutral',
};

const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'cancelled'] as const;

export default function HrSwapsPage() {
  const t = useTranslations('hr.swaps');

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [view, setView] = useViewMode('hr-swaps');

  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [loading, setLoading] = useState(true);

  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

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

  const renderAssignment = useCallback(
    (a: string | null) => (a == null ? '—' : a === 'day_off' ? t('dayOff') : a),
    [t]
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
      setSwaps([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ store_id: storeId });
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`/api/hr/dayoff-swaps?${params.toString()}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setSwaps((json.data ?? []) as Swap[]);
    } catch {
      setSwaps([]);
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
        const res = await fetch(`/api/hr/dayoff-swaps/${id}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, note: note?.trim() || undefined }),
        });
        if (!res.ok) throw new Error();
        toast({
          type: 'success',
          title: decision === 'approved' ? t('approved') : t('rejected'),
        });
        await load();
      } catch {
        toast({ type: 'error', title: t('actionFailed') });
      }
    },
    [t, load]
  );

  const ack = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/hr/dayoff-swaps/${id}/ack`, { method: 'POST' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || json?.message || t('actionFailed'));
        toast({ type: 'success', title: t('acknowledged') });
        await load();
      } catch (e) {
        toast({ type: 'error', title: e instanceof Error ? e.message : t('actionFailed') });
      }
    },
    [t, load]
  );

  const storeOptions = stores.map((s) => ({ value: s.id, label: s.store_name }));
  const statusOptions = STATUS_FILTERS.map((s) => ({
    value: s,
    label:
      s === 'all'
        ? t('statusAll')
        : s === 'pending'
          ? t('statusPending')
          : s === 'approved'
            ? t('statusApproved')
            : s === 'rejected'
              ? t('statusRejected')
              : t('statusCancelled'),
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeader
        title={t('title')}
        subtitle={t('hrSubtitle')}
        actions={<ViewToggle value={view} onChange={setView} />}
      />

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

      {/* list */}
      {loading ? (
        <SkeletonList rows={5} />
      ) : swaps.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-400 dark:border-gray-700">
          <ArrowLeftRight className="h-8 w-8" />
          {t('noSwaps')}
        </div>
      ) : (
        <DataList compact={view === 'compact'}>
          {swaps.map((s) => (
            <DataCard
              key={s.id}
              accent={STATUS_TONE[s.status]}
              title={
                <>
                  <EmployeeName name={s.requester_name} nickname={s.requester_nickname} /> ({s.requester_date}){' '}
                  <ArrowLeftRight className="inline h-3.5 w-3.5 align-middle text-gray-400" />{' '}
                  <EmployeeName name={s.counterpart_name} nickname={s.counterpart_nickname} /> ({s.counterpart_date})
                </>
              }
              status={<StatusBadge tone={STATUS_TONE[s.status]} label={statusLabel(s.status)} />}
              actions={
                s.status === 'pending' ? (
                  rejectId === s.id ? (
                    <div className="flex w-full flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder={t('decisionNote')}
                        className="control flex-1"
                      />
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => decide(s.id, 'rejected', rejectNote)}
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
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRejectId(s.id);
                          setRejectNote('');
                        }}
                      >
                        {t('reject')}
                      </Button>
                      <Button size="sm" onClick={() => decide(s.id, 'approved')}>
                        {t('approve')}
                      </Button>
                    </>
                  )
                ) : s.status === 'approved' && !s.hr_acked_at ? (
                  <Button size="sm" variant="outline" onClick={() => ack(s.id)}>
                    {t('acknowledge')}
                  </Button>
                ) : undefined
              }
            >
              <p>
                {t('requester')}: {renderAssignment(s.requester_assignment)} ·{' '}
                {t('counterpartLabel')}: {renderAssignment(s.counterpart_assignment)}
              </p>
              {s.note && <p>{s.note}</p>}
            </DataCard>
          ))}
        </DataList>
      )}
    </div>
  );
}
