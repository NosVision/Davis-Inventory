'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Select, PageHeader, StatusBadge, FilterBar, FilterField, toast } from '@/components/ui';
import { DataTable, type Column } from '@/components/data/data-table';
import { createClient } from '@/lib/supabase/client';
import { openBusinessDateBangkok, formatTimeBangkok } from '@/lib/utils/date';

interface AttendanceRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  store_id: string | null;
  type: string;
  ts: string;
  business_date: string;
  distance_m: number | null;
  in_geofence: boolean | null;
  is_vpn_suspect: boolean;
  ip_country: string | null;
  employee_name: string | null;
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
    [date, storeId, type, suspectOnly, t]
  );

  // Refetch from the top whenever a filter changes.
  useEffect(() => {
    fetchRows(0, false);
  }, [fetchRows]);

  const columns = useMemo<Column<AttendanceRow>[]>(
    () => [
      {
        key: 'employee',
        header: t('colEmployee'),
        render: (r) => (
          <span className="font-medium text-gray-900 dark:text-white">
            {r.employee_name || '—'}
          </span>
        ),
      },
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
    [t]
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

      {/* filters */}
      <FilterBar>
        <FilterField label={t('filterDate')}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="control"
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
      </FilterBar>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t('total')}: <span className="tabular-nums font-medium">{total}</span>
      </p>

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
    </div>
  );
}
