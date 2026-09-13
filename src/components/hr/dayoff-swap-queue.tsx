'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowLeftRight } from 'lucide-react';
import { Button, Select, PageHeader, DataList, DataCard, StatusBadge, SkeletonList, ViewToggle, useViewMode, toast } from '@/components/ui';
import { EmployeeName } from '@/components/hr/employee-name';
import type { SwapBlockReason } from '@/lib/hr/dayoff-swap';

interface StoreOpt {
  id: string;
  store_code: string;
  store_name: string;
}
type SwapPreview = { ok: true; counterpart_trades: boolean } | { ok: false; reason: SwapBlockReason } | null;
interface Swap {
  id: string;
  requester_name: string;
  requester_nickname: string | null;
  counterpart_name: string;
  counterpart_nickname: string | null;
  requester_date: string;
  counterpart_date: string;
  same_day: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  note: string | null;
  decided_at: string | null;
  hr_acked_at: string | null;
  /** what approving would do on today's roster — pending swaps only */
  preview: SwapPreview;
}

const STATUS_TONE: Record<Swap['status'], 'warn' | 'good' | 'critical' | 'neutral'> = {
  pending: 'warn',
  approved: 'good',
  rejected: 'critical',
  cancelled: 'neutral',
};

const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'cancelled'] as const;

const BLOCK_KEY: Record<SwapBlockReason, string> = {
  requester_missing: 'blockedRequesterMissing',
  counterpart_missing: 'blockedCounterpartMissing',
  requester_not_off: 'blockedRequesterNotOff',
  requester_already_off: 'blockedRequesterAlreadyOff',
};

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' */
function dmy(d: string): string {
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return y && m && dd ? `${dd}/${m}/${y}` : String(d);
}

/**
 * The day-off swap queue — one component, two doors:
 *   • mode "store" (/schedule/swaps) — the store's manager or captain, who decide swaps
 *   • mode "hr"    (/hr/swaps)       — company HR, who acknowledge approved swaps and still decide
 *                                      as the fallback for a store with nobody set up
 * The queue used to exist only under /hr, where the captains it was built for could not open it
 * (owner report 2026-09-13). The API is the gate either way.
 */
export function DayoffSwapQueue({ mode }: { mode: 'hr' | 'store' }) {
  const t = useTranslations('hr.swaps');

  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  // A store approver comes here for what waits on them; HR comes to acknowledge what was decided.
  const [status, setStatus] = useState<string>(mode === 'store' ? 'pending' : 'all');
  const [view, setView] = useViewMode(mode === 'store' ? 'store-swaps' : 'hr-swaps');

  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const statusLabel = useCallback(
    (s: Swap['status'] | 'all') =>
      s === 'all'
        ? t('statusAll')
        : s === 'pending'
          ? t('statusPending')
          : s === 'approved'
            ? t('statusApproved')
            : s === 'rejected'
              ? t('statusRejected')
              : t('statusCancelled'),
    [t]
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/manageable-stores?capability=schedule');
        const json = await res.json();
        const list = (json.data ?? []) as StoreOpt[];
        setStores(list);
        setStoreId((prev) => prev || list[0]?.id || '');
      } catch {
        setStores([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!storeId) {
      setSwaps([]);
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
      setBusyId(id);
      try {
        const res = await fetch(`/api/hr/dayoff-swaps/${id}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, note: note?.trim() || undefined }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof json?.error === 'string' ? json.error : t('actionFailed'));
        toast({ type: 'success', title: decision === 'approved' ? t('approved') : t('rejected') });
        await load();
      } catch (e) {
        toast({ type: 'error', title: e instanceof Error ? e.message : t('actionFailed') });
      } finally {
        setBusyId(null);
      }
    },
    [t, load]
  );

  const ack = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        const res = await fetch(`/api/hr/dayoff-swaps/${id}/ack`, { method: 'POST' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || json?.message || t('actionFailed'));
        toast({ type: 'success', title: t('acknowledged') });
        await load();
      } catch (e) {
        toast({ type: 'error', title: e instanceof Error ? e.message : t('actionFailed') });
      } finally {
        setBusyId(null);
      }
    },
    [t, load]
  );

  const shortName = (name: string, nickname: string | null) => nickname || name;

  const renderOutcome = (s: Swap) => {
    if (s.status !== 'pending' || !s.preview) return null;
    if (!s.preview.ok) {
      return (
        <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t(BLOCK_KEY[s.preview.reason])}</span>
        </p>
      );
    }
    const requester = shortName(s.requester_name, s.requester_nickname);
    const counterpart = shortName(s.counterpart_name, s.counterpart_nickname);
    if (s.same_day) {
      return <p>{t('sameDayTrade', { a: requester, b: counterpart, date: dmy(s.requester_date) })}</p>;
    }
    return (
      <>
        <p>{t('moveDayOff', { name: requester, from: dmy(s.requester_date), to: dmy(s.counterpart_date) })}</p>
        <p>
          {s.preview.counterpart_trades
            ? t('moveDayOff', { name: counterpart, from: dmy(s.counterpart_date), to: dmy(s.requester_date) })
            : t('counterpartUnchanged', { name: counterpart })}
        </p>
      </>
    );
  };

  const renderActions = (s: Swap) => {
    if (s.status === 'pending') {
      if (rejectId === s.id) {
        return (
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
              isLoading={busyId === s.id}
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
        );
      }
      return (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busyId !== null}
            onClick={() => {
              setRejectId(s.id);
              setRejectNote('');
            }}
          >
            {t('reject')}
          </Button>
          <Button
            size="sm"
            isLoading={busyId === s.id}
            // A roster that moved since filing cannot carry out the request — reject it instead.
            disabled={busyId !== null || (s.preview !== null && !s.preview.ok)}
            onClick={() => decide(s.id, 'approved')}
          >
            {t('approve')}
          </Button>
        </>
      );
    }
    if (s.status === 'approved' && !s.hr_acked_at) {
      return mode === 'hr' ? (
        <Button size="sm" variant="outline" isLoading={busyId === s.id} onClick={() => ack(s.id)}>
          {t('acknowledge')}
        </Button>
      ) : (
        <span className="text-xs text-gray-500 dark:text-gray-400">{t('awaitingHrAck')}</span>
      );
    }
    return undefined;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeader
        title={t('title')}
        subtitle={mode === 'store' ? t('storeSubtitle') : t('hrSubtitle')}
        actions={<ViewToggle value={view} onChange={setView} />}
      />

      <div className="grid grid-cols-2 gap-3">
        <Select
          label={t('storeLabel')}
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          options={stores.map((s) => ({ value: s.id, label: s.store_name }))}
        />
        <Select
          label={t('status')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={STATUS_FILTERS.map((s) => ({ value: s, label: statusLabel(s) }))}
        />
      </div>

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
                s.same_day ? (
                  <>
                    <EmployeeName name={s.requester_name} nickname={s.requester_nickname} />{' '}
                    <ArrowLeftRight className="inline h-3.5 w-3.5 align-middle text-gray-400" />{' '}
                    <EmployeeName name={s.counterpart_name} nickname={s.counterpart_nickname} /> ·{' '}
                    {t('cardSameDay', { date: dmy(s.requester_date) })}
                  </>
                ) : (
                  <>
                    <EmployeeName name={s.requester_name} nickname={s.requester_nickname} /> ·{' '}
                    {t('cardMove', { from: dmy(s.requester_date), to: dmy(s.counterpart_date) })} ·{' '}
                    {t('withCoworker', { name: shortName(s.counterpart_name, s.counterpart_nickname) })}
                  </>
                )
              }
              status={<StatusBadge tone={STATUS_TONE[s.status]} label={statusLabel(s.status)} />}
              actions={renderActions(s)}
            >
              {renderOutcome(s)}
              {s.note && <p>{s.note}</p>}
            </DataCard>
          ))}
        </DataList>
      )}
    </div>
  );
}
