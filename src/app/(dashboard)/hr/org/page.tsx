'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil } from 'lucide-react';
import { Button, Badge, Tabs, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

interface OrgRow {
  id: string;
  name: string;
  sort_order?: number;
  active: boolean;
}

const INPUT_CLS =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors ' +
  'placeholder:text-gray-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 ' +
  'dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500';

interface OrgListProps {
  endpoint: string;
  withSort: boolean;
  addLabel: string;
}

function OrgList({ endpoint, withSort, addLabel }: OrgListProps) {
  const t = useTranslations('hr.org');

  const [rows, setRows] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // add form
  const [newName, setNewName] = useState('');
  const [newSort, setNewSort] = useState('');

  // inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSort, setEditSort] = useState('');

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(endpoint);
      if (res.ok) {
        const json = await res.json();
        setRows((json.data ?? []) as OrgRow[]);
      } else {
        const json = await res.json().catch(() => ({}));
        toast({ type: 'error', title: t('saveFailed'), message: json.error });
      }
    } finally {
      setLoading(false);
    }
  }, [endpoint, t]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const failToast = (message?: string) => {
    toast({ type: 'error', title: t('saveFailed'), message });
  };

  const addItem = async () => {
    const name = newName.trim();
    if (!name) {
      toast({ type: 'error', title: t('requiredName') });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withSort ? { name, sort_order: Number(newSort) || 0 } : { name }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        failToast(json.error);
        return;
      }
      toast({ type: 'success', title: t('createdOk') });
      setNewName('');
      setNewSort('');
      await fetchRows();
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row: OrgRow) => {
    setEditId(row.id);
    setEditName(row.name);
    setEditSort(row.sort_order != null ? String(row.sort_order) : '');
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditName('');
    setEditSort('');
  };

  const saveEdit = async (row: OrgRow) => {
    const name = editName.trim();
    if (!name) {
      toast({ type: 'error', title: t('requiredName') });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { name };
      if (withSort) payload.sort_order = Number(editSort) || 0;
      const res = await fetch(`${endpoint}/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        failToast(json.error);
        return;
      }
      toast({ type: 'success', title: t('savedOk') });
      cancelEdit();
      await fetchRows();
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: OrgRow) => {
    setSaving(true);
    try {
      const res = await fetch(`${endpoint}/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !row.active }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        failToast(json.error);
        return;
      }
      toast({ type: 'success', title: t('savedOk') });
      await fetchRows();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* add row */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/40">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addItem();
          }}
          placeholder={t('namePlaceholder')}
          aria-label={t('name')}
          className={cn(INPUT_CLS, 'min-w-0 flex-1')}
        />
        {withSort && (
          <input
            type="number"
            value={newSort}
            onChange={(e) => setNewSort(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addItem();
            }}
            placeholder={t('sortOrder')}
            aria-label={t('sortOrder')}
            className={cn(INPUT_CLS, 'w-20 shrink-0 tabular-nums')}
          />
        )}
        <Button size="sm" onClick={addItem} isLoading={saving} className="shrink-0">
          <Plus className="h-4 w-4" />
          {addLabel}
        </Button>
      </div>

      {/* list */}
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
          {t('empty')}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-2 bg-white px-3 py-2.5 dark:bg-gray-900"
            >
              {editId === row.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit(row);
                      if (e.key === 'Escape') cancelEdit();
                    }}
                    aria-label={t('name')}
                    className={cn(INPUT_CLS, 'min-w-0 flex-1')}
                    autoFocus
                  />
                  {withSort && (
                    <input
                      type="number"
                      value={editSort}
                      onChange={(e) => setEditSort(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(row);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      aria-label={t('sortOrder')}
                      className={cn(INPUT_CLS, 'w-20 shrink-0 tabular-nums')}
                    />
                  )}
                  <Button size="sm" onClick={() => saveEdit(row)} isLoading={saving}>
                    {t('save')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
                    {t('cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-white">
                    {row.name}
                  </span>
                  {withSort && (
                    <span className="w-8 shrink-0 text-right text-xs tabular-nums text-gray-400">
                      {row.sort_order ?? 0}
                    </span>
                  )}
                  <Badge variant={row.active ? 'success' : 'default'} size="sm">
                    {row.active ? t('active') : t('inactive')}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    title={t('edit')}
                    aria-label={t('edit')}
                    className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-400"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <Button
                    size="sm"
                    variant={row.active ? 'ghost' : 'outline'}
                    onClick={() => toggleActive(row)}
                    disabled={saving}
                    className="shrink-0"
                  >
                    {row.active ? t('deactivate') : t('activate')}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function OrgPage() {
  const t = useTranslations('hr.org');
  const [tab, setTab] = useState<'positions' | 'departments'>('positions');

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
      </div>

      <Tabs
        tabs={[
          { id: 'positions', label: t('tabPositions') },
          { id: 'departments', label: t('tabDepartments') },
        ]}
        activeTab={tab}
        onChange={(id) => setTab(id as 'positions' | 'departments')}
      />

      {tab === 'positions' ? (
        <OrgList endpoint="/api/hr/positions" withSort addLabel={t('addPosition')} />
      ) : (
        <OrgList endpoint="/api/hr/departments" withSort={false} addLabel={t('addDepartment')} />
      )}
    </div>
  );
}
