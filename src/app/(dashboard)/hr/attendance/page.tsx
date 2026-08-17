'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { Button, Select, PageHeader, StatusBadge, FilterBar, FilterField, toast } from '@/components/ui';
import { DataTable, type Column } from '@/components/data/data-table';
import { createClient } from '@/lib/supabase/client';
import { openBusinessDateBangkok, formatTimeBangkok } from '@/lib/utils/date';
import { AttendanceReviewModal, type ReviewRow } from './_components/review-modal';
import { EmployeeName } from '@/components/hr/employee-name';

interface AttendanceRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  store_id: string | null;
  type: string;
  ts: string;
  business_date: string;
  distance_m: number | null;
  in_geofence: boolean | null;
  review_status: string | null;
  is_vpn_suspect: boolean;
  ip_country: string | null;
  employee_name: string | null;
  employee_nickname: string | null;
  store_label: string | null;
  photo_signed_url: string | null;
}

interface StoreOption {
  id: string;
  store_name: string;
}

const ATTENDANCE_TYPES = ['in', 'out', 'break_start', 'break_end'] as const;

// db type value → i18n key under hr.attendance
const TYPE_KEY: Record<string, string> = {
  in: 'in',
  out: 'out',
  break_start: 'breakStart',
  break_end: 'breakEnd',
};

const PAGE_SIZE = 50;

export default function AttendanceReportPage() {
  const t = useTranslations('hr.attendance');

  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  // filters
  const [date, setDate] = useState<string>(() => openBusinessDateBangkok());
  const [storeId, setStoreId] = useState('');
  const [type, setType] = useState('');
  const [suspectOnly, setSuspectOnly] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [reviewRow, setReviewRow] = useState<ReviewRow | null>(null);

  // How many punches are awaiting review across EVERY date. The HR hub badges this number, but the
  // page opens on today and pending punches are almost never today's — so the count was reachable
  // only by ticking a filter nobody knew to tick (owner report 2026-08-17). Held separately from
  // the row list so the daily view can point at a backlog it is not showing.
  const [pendingTotal, setPendingTotal] = useState(0);

  // Deep links: the hub's "needs action" chip and tile badge arrive with ?review=pending, which is
  // the all-dates queue. Read off window.location rather than useSearchParams so the page needs no
  // Suspense boundary (same approach as /hr/timesheet). Runs once, before the first fetch.
  const [paramsRead, setParamsRead] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('review') === 'pending') setReviewOnly(true);
    const qStore = p.get('store');
    if (qStore) setStoreId(qStore);
    const qDate = p.get('date');
    if (qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate)) setDate(qDate);
    setParamsRead(true);
  }, []);

  // store options (active branches) — same source as announcements/assets
  const [stores, setStores] = useState<StoreOption[]>([]);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from('stores')
        .select('id, store_name')
        .eq('active', true)
        .order('store_name');
      setStores((data ?? []) as StoreOption[]);
    })();
  }, []);

  const fetchRows = useCallback(
    async (nextOffset: number, append: boolean) => {
      setLoading(true);
      const params = new URLSearchParams();
      if (date) params.set('business_date', date);
      if (storeId) params.set('store_id', storeId);
      if (type) params.set('type', type);
      if (suspectOnly) params.set('suspect', 'true');
      if (reviewOnly) params.set('review', 'pending');
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(nextOffset));
      try {
        const res = await fetch(`/api/hr/attendance?${params.toString()}`);
        if (!res.ok) throw new Error('load failed');
        const json = await res.json();
        const data = (json.data ?? []) as AttendanceRow[];
        setRows((prev) => (append ? [...prev, ...data] : data));
        setTotal(json.total ?? 0);
        setOffset(nextOffset);
      } catch {
        toast({ type: 'error', title: t('loadFailed') });
      } finally {
        setLoading(false);
      }
    },
    [date, storeId, type, suspectOnly, reviewOnly, t]
  );

  // The all-dates pending count. One row is enough — we only want the `total`.
  const loadPendingTotal = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/attendance?review=pending&limit=1');
      if (!res.ok) return;
      const json = await res.json();
      setPendingTotal(Number(json.total) || 0);
    } catch {
      // a failed count simply hides the banner — it must never block the report
    }
  }, []);

  // Refetch from the top whenever a filter changes — but not before the URL params have been
  // applied, or a ?review=pending deep link would fetch today's list first and then the queue.
  useEffect(() => {
    if (!paramsRead) return;
    fetchRows(0, false);
  }, [fetchRows, paramsRead]);

  useEffect(() => {
    loadPendingTotal();
  }, [loadPendingTotal]);


  const columns = useMemo<Column<AttendanceRow>[]>(
    () => [
      {
        key: 'employee',
        header: t('colEmployee'),
        render: (r) => (
          <EmployeeName
            name={r.employee_name || '—'}
            nickname={r.employee_nickname}
            className="font-medium text-gray-900 dark:text-white"
          />
        ),
      },
      // The queue spans every date, so a bare "21:47" would not say which day it belongs to.
      // Only shown in queue mode — in the daily view the date is already the filter.
      ...(reviewOnly
        ? [
            {
              key: 'date',
              header: t('colDate'),
              render: (r: AttendanceRow) => (
                <span className="whitespace-nowrap tabular-nums text-gray-700 dark:text-gray-300">
                  {r.business_date}
                </span>
              ),
            },
          ]
        : []),
      {
        key: 'time',
        header: t('colTime'),
        render: (r) => (
          <span className="whitespace-nowrap tabular-nums text-gray-500 dark:text-gray-400">
            {formatTimeBangkok(r.ts)}
          </span>
        ),
      },
      {
        key: 'type',
        header: t('colType'),
        render: (r) => <StatusBadge tone="info" label={t(TYPE_KEY[r.type] ?? 'in')} />,
      },
      {
        key: 'branch',
        header: t('colBranch'),
        render: (r) => r.store_label || '—',
      },
      {
        key: 'geofence',
        header: t('colGeofence'),
        render: (r) => {
          const dist =
            r.distance_m != null ? ` · ${Math.round(r.distance_m)} m` : '';
          if (r.in_geofence === true) {
            return <StatusBadge tone="good" label={`${t('inRange')}${dist}`} />;
          }
          if (r.in_geofence === false) {
            return <StatusBadge tone="warn" label={`${t('outRange')}${dist}`} />;
          }
          return <StatusBadge tone="neutral" label={t('noGeofence')} />;
        },
      },
      {
        key: 'ipCountry',
        header: t('colIpCountry'),
        render: (r) => (
          <span className="tabular-nums text-gray-500 dark:text-gray-400">
            {r.ip_country ?? '—'}
          </span>
        ),
      },
      {
        key: 'suspect',
        header: t('colSuspect'),
        render: (r) =>
          r.is_vpn_suspect ? (
            <StatusBadge tone="critical" label={t('suspect')} />
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-500">{t('notSuspect')}</span>
          ),
      },
      {
        key: 'review',
        header: t('colReview'),
        render: (r) => {
          if (r.review_status === 'pending') {
            return (
              <Button size="sm" onClick={() => setReviewRow({
                id: r.id, user_id: r.user_id, employee_name: r.employee_name, employee_nickname: r.employee_nickname, type: r.type, ts: r.ts,
                distance_m: r.distance_m, is_vpn_suspect: r.is_vpn_suspect,
              })}>
                {t('colReview')}
              </Button>
            );
          }
          if (r.review_status === 'approved') return <StatusBadge tone="good" label={t('reviewApproved')} />;
          if (r.review_status === 'rejected') return <StatusBadge tone="critical" label={t('reviewRejected')} />;
          return <span className="text-xs text-gray-400 dark:text-gray-500">—</span>;
        },
      },
      {
        key: 'photo',
        header: t('colPhoto'),
        render: (r) =>
          r.photo_signed_url ? (
            <a
              href={r.photo_signed_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {t('viewPhoto')}
            </a>
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-500">{t('none')}</span>
          ),
      },
    ],
    [t, reviewOnly]
  );

  const typeOptions = [
    { value: '', label: t('allTypes') },
    ...ATTENDANCE_TYPES.map((tp) => ({ value: tp, label: t(TYPE_KEY[tp]) })),
  ];
  const storeOptions = [
    { value: '', label: t('allStores') },
    ...stores.map((s) => ({ value: s.id, label: s.store_name })),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {/* The backlog this page is not showing. Without this, the only route to a pending punch was
          knowing to tick a filter — the HR hub's badge pointed here and the list looked empty. */}
      {!reviewOnly && pendingTotal > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/15 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0">{t('pendingElsewhere', { n: pendingTotal })}</span>
          <Button size="sm" className="ml-auto" onClick={() => setReviewOnly(true)}>
            {t('showPendingQueue')}
          </Button>
        </div>
      )}

      {/* filters */}
      <FilterBar>
        <FilterField label={t('filterDate')}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            // The queue ignores the date server-side, so leaving this live would look like a
            // filter that does nothing. Disabled and explained below instead.
            disabled={reviewOnly}
            className="control disabled:cursor-not-allowed disabled:opacity-50"
          />
        </FilterField>
        <Select
          label={t('filterStore')}
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          options={storeOptions}
        />
        <Select
          label={t('filterType')}
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={typeOptions}
        />
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={suspectOnly}
            onChange={(e) => setSuspectOnly(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
          />
          {t('suspectOnly')}
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={reviewOnly}
            onChange={(e) => setReviewOnly(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 dark:border-gray-600 dark:bg-gray-800"
          />
          {t('reviewOnly')}
        </label>
      </FilterBar>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <span>
          {t('total')}: <span className="tabular-nums font-medium">{total}</span>
        </span>
        {reviewOnly && (
          <>
            <span className="text-amber-600 dark:text-amber-400">{t('reviewQueueSpansDates')}</span>
            <button
              type="button"
              onClick={() => setReviewOnly(false)}
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {t('backToDate')}
            </button>
          </>
        )}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(r) => r.id}
        emptyMessage={t('empty')}
        isLoading={loading && rows.length === 0}
      />

      {rows.length < total && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchRows(offset + PAGE_SIZE, true)}
            disabled={loading}
          >
            {t('loadMore')}
          </Button>
        </div>
      )}

      <AttendanceReviewModal
        row={reviewRow}
        onClose={() => setReviewRow(null)}
        // Clearing a punch shrinks the backlog — re-read the count so the banner and the hub badge
        // never disagree with what HR just did.
        onDone={() => { setReviewRow(null); fetchRows(0, false); loadPendingTotal(); }}
      />
    </div>
  );
}
