'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Select, Badge, toast } from '@/components/ui';
import { DataTable, type Column } from '@/components/data/data-table';

interface AuditRow extends Record<string, unknown> {
  id: string;
  actor_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  reason: string | null;
  created_at: string;
  actor: { display_name?: string | null; username?: string | null } | null;
}

// hr_* tables that emit audit rows (mirrors logHrAudit call sites).
const AUDITED_TABLES = ['hr_employees', 'hr_companies', 'hr_positions', 'hr_departments'];
const ACTIONS = ['create', 'update', 'delete'];
const PAGE_SIZE = 50;

const ACTION_VARIANT: Record<string, 'success' | 'info' | 'danger' | 'default'> = {
  create: 'success',
  update: 'info',
  delete: 'danger',
};

export default function AuditLogPage() {
  const t = useTranslations('hr.audit');

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [count, setCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  // filters
  const [table, setTable] = useState('');
  const [action, setAction] = useState('');

  const fetchLogs = useCallback(
    async (nextOffset: number, append: boolean) => {
      setLoading(true);
      const params = new URLSearchParams();
      if (table) params.set('table', table);
      if (action) params.set('action', action);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(nextOffset));
      try {
        const res = await fetch(`/api/hr/audit?${params.toString()}`);
        if (!res.ok) throw new Error('load failed');
        const json = await res.json();
        const data = (json.data ?? []) as AuditRow[];
        setRows((prev) => (append ? [...prev, ...data] : data));
        setCount(json.count ?? 0);
        setOffset(nextOffset);
      } catch {
        toast({ type: 'error', title: t('loadFailed') });
      } finally {
        setLoading(false);
      }
    },
    [table, action, t]
  );

  // Refetch from the top whenever a filter changes (selects need no debounce).
  useEffect(() => {
    fetchLogs(0, false);
  }, [fetchLogs]);

  const columns = useMemo<Column<AuditRow>[]>(
    () => [
      {
        key: 'time',
        header: t('colTime'),
        render: (r) => (
          <span className="whitespace-nowrap tabular-nums text-gray-500 dark:text-gray-400">
            {new Date(r.created_at).toLocaleString('th-TH')}
          </span>
        ),
      },
      {
        key: 'actor',
        header: t('colActor'),
        render: (r) => (
          <span className="font-medium text-gray-900 dark:text-white">
            {r.actor?.display_name || r.actor?.username || '—'}
          </span>
        ),
      },
      {
        key: 'action',
        header: t('colAction'),
        render: (r) => (
          <Badge variant={ACTION_VARIANT[r.action] ?? 'default'} size="sm">
            {t(`act.${r.action}`)}
          </Badge>
        ),
      },
      { key: 'table', header: t('colTable'), render: (r) => r.table_name || '—' },
      {
        key: 'record',
        header: t('colRecord'),
        render: (r) => (
          <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
            {r.record_id ? `${r.record_id.slice(0, 8)}…` : '—'}
          </span>
        ),
      },
      { key: 'reason', header: t('colReason'), render: (r) => r.reason || '—' },
    ],
    [t]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
      </div>

      {/* filters */}
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <Select
          label={t('filterTable')}
          value={table}
          onChange={(e) => setTable(e.target.value)}
          options={[{ value: '', label: t('all') }, ...AUDITED_TABLES.map((tb) => ({ value: tb, label: tb }))]}
        />
        <Select
          label={t('filterAction')}
          value={action}
          onChange={(e) => setAction(e.target.value)}
          options={[{ value: '', label: t('all') }, ...ACTIONS.map((a) => ({ value: a, label: t(`act.${a}`) }))]}
        />
      </div>

      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(r) => r.id}
        emptyMessage={t('empty')}
        isLoading={loading && rows.length === 0}
      />

      {rows.length < count && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => fetchLogs(offset + PAGE_SIZE, true)} disabled={loading}>
            {t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
