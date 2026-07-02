'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button, Select, Badge, Modal, Input, Textarea, toast } from '@/components/ui';
import { DataTable, type Column } from '@/components/data/data-table';
import { createClient } from '@/lib/supabase/client';
import { formatBaht } from '@/lib/pos/money';

interface HolderOpt {
  id: string;
  name: string;
}

interface AssetRow extends Record<string, unknown> {
  id: string;
  name: string;
  category: string | null;
  asset_code: string | null;
  holder_id: string | null;
  value_satang: number;
  status: string;
  issued_date: string | null;
  returned_date: string | null;
  notes: string | null;
  holder: { id: string; display_name: string | null; username: string | null } | null;
}

const STATUSES = ['in_stock', 'issued', 'returned', 'lost', 'damaged'];

const STATUS_VARIANT: Record<string, 'default' | 'info' | 'success' | 'danger' | 'warning'> = {
  in_stock: 'default',
  issued: 'info',
  returned: 'success',
  lost: 'danger',
  damaged: 'warning',
};

interface AssetForm {
  name: string;
  category: string;
  asset_code: string;
  holder_id: string;
  value_baht: string;
  status: string;
  issued_date: string;
  returned_date: string;
  notes: string;
}

function defaultForm(): AssetForm {
  return {
    name: '',
    category: '',
    asset_code: '',
    holder_id: '',
    value_baht: '',
    status: 'in_stock',
    issued_date: '',
    returned_date: '',
    notes: '',
  };
}

export default function AssetsPage() {
  const t = useTranslations('hr.assets');

  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [holderId, setHolderId] = useState('');

  // holder options (active employees)
  const [holders, setHolders] = useState<HolderOpt[]>([]);

  // editor modal
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<AssetForm>(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isCreate = editId === null;

  const update = <K extends keyof AssetForm>(key: K, value: AssetForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, username')
        .eq('active', true)
        .order('display_name');
      setHolders(
        (data ?? []).map((r) => ({
          id: r.id as string,
          name: (r.display_name as string) || (r.username as string) || '—',
        }))
      );
    })();
  }, []);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (holderId) params.set('holder_id', holderId);
    const res = await fetch(`/api/hr/assets?${params.toString()}`);
    if (res.ok) {
      const json = await res.json();
      setRows((json.data ?? []) as AssetRow[]);
    }
    setLoading(false);
  }, [q, status, holderId]);

  useEffect(() => {
    const id = setTimeout(fetchAssets, 250); // debounce search
    return () => clearTimeout(id);
  }, [fetchAssets]);

  function openCreate() {
    setEditId(null);
    setForm(defaultForm());
    setFormOpen(true);
  }

  function openEdit(row: AssetRow) {
    setEditId(row.id);
    setForm({
      name: row.name ?? '',
      category: row.category ?? '',
      asset_code: row.asset_code ?? '',
      holder_id: row.holder_id ?? '',
      value_baht: row.value_satang != null ? String(row.value_satang / 100) : '',
      status: row.status ?? 'in_stock',
      issued_date: row.issued_date ?? '',
      returned_date: row.returned_date ?? '',
      notes: row.notes ?? '',
    });
    setFormOpen(true);
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      toast({ type: 'error', title: t('requiredName') });
      return;
    }
    const body = {
      name: form.name.trim(),
      category: form.category.trim() || null,
      asset_code: form.asset_code.trim() || null,
      holder_id: form.holder_id || null,
      value_baht: Number(form.value_baht) || 0,
      status: form.status,
      issued_date: form.issued_date || null,
      returned_date: form.returned_date || null,
      notes: form.notes.trim() || null,
    };

    setSubmitting(true);
    try {
      const res = await fetch(isCreate ? '/api/hr/assets' : `/api/hr/assets/${editId}`, {
        method: isCreate ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed'), message: typeof json.error === 'string' ? json.error : undefined });
        return;
      }
      toast({ type: 'success', title: t('savedOk') });
      setFormOpen(false);
      fetchAssets();
    } catch (e) {
      toast({ type: 'error', title: t('saveFailed'), message: e instanceof Error ? e.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (isCreate) return;
    if (!window.confirm(t('confirmDelete'))) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/hr/assets/${editId}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ type: 'error', title: t('saveFailed'), message: typeof json.error === 'string' ? json.error : undefined });
        return;
      }
      toast({ type: 'success', title: t('savedOk') });
      setFormOpen(false);
      fetchAssets();
    } catch (e) {
      toast({ type: 'error', title: t('saveFailed'), message: e instanceof Error ? e.message : undefined });
    } finally {
      setDeleting(false);
    }
  }

  const columns = useMemo<Column<AssetRow>[]>(
    () => [
      {
        key: 'name',
        header: t('name'),
        render: (a) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-gray-900 dark:text-white">{a.name || '—'}</div>
            {a.asset_code && <div className="text-xs text-gray-400">{a.asset_code}</div>}
          </div>
        ),
      },
      { key: 'category', header: t('category'), render: (a) => a.category || '—' },
      {
        key: 'holder',
        header: t('holder'),
        render: (a) =>
          a.holder ? a.holder.display_name || a.holder.username || '—' : t('unassigned'),
      },
      {
        key: 'value',
        header: t('value'),
        className: 'text-right',
        render: (a) => <span className="tabular-nums">{formatBaht(a.value_satang ?? 0)}</span>,
      },
      {
        key: 'status',
        header: t('status'),
        render: (a) => (
          <Badge variant={STATUS_VARIANT[a.status] ?? 'default'} size="sm">
            {t(`statusOpt.${a.status}`)}
          </Badge>
        ),
      },
    ],
    [t]
  );

  const holderOptions = holders.map((h) => ({ value: h.id, label: h.name }));
  const statusOptions = STATUSES.map((s) => ({ value: s, label: t(`statusOpt.${s}`) }));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <Plus className="h-4 w-4" />
          {t('add')}
        </Button>
      </div>

      {/* filters */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="col-span-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          placeholder={t('filterStatus')}
          options={[{ value: '', label: t('all') }, ...statusOptions]}
        />
        <Select
          value={holderId}
          onChange={(e) => setHolderId(e.target.value)}
          placeholder={t('filterHolder')}
          options={[{ value: '', label: t('all') }, ...holderOptions]}
        />
      </div>

      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(a) => a.id}
        emptyMessage={t('empty')}
        isLoading={loading}
        onRowClick={openEdit}
      />

      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={isCreate ? t('add') : t('edit')}
        size="lg"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label={t('name')}
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder={t('namePlaceholder')}
            />
          </div>
          <Input label={t('category')} value={form.category} onChange={(e) => update('category', e.target.value)} />
          <Input label={t('code')} value={form.asset_code} onChange={(e) => update('asset_code', e.target.value)} />
          <Select
            label={t('holder')}
            value={form.holder_id}
            onChange={(e) => update('holder_id', e.target.value)}
            options={[{ value: '', label: t('unassigned') }, ...holderOptions]}
          />
          <Input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            label={t('value')}
            value={form.value_baht}
            onChange={(e) => update('value_baht', e.target.value)}
          />
          <Select
            label={t('status')}
            value={form.status}
            onChange={(e) => update('status', e.target.value)}
            options={statusOptions}
          />
          <Input
            type="date"
            label={t('issuedDate')}
            value={form.issued_date}
            onChange={(e) => update('issued_date', e.target.value)}
          />
          <Input
            type="date"
            label={t('returnedDate')}
            value={form.returned_date}
            onChange={(e) => update('returned_date', e.target.value)}
          />
          <div className="sm:col-span-2">
            <Textarea
              label={t('notes')}
              rows={2}
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
            />
          </div>

          <div className="col-span-full mt-2 flex items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-gray-700">
            <div>
              {!isCreate && (
                <Button type="button" variant="ghost" onClick={handleDelete} isLoading={deleting} disabled={submitting || deleting}>
                  {t('delete')}
                </Button>
              )}
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={submitting || deleting}>
                {t('cancel')}
              </Button>
              <Button type="button" onClick={handleSubmit} isLoading={submitting} disabled={submitting || deleting}>
                {t('save')}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
