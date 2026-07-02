'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Eye } from 'lucide-react';
import { Button, Badge, Input, Textarea, Modal, ModalFooter, toast } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

interface Announcement {
  id: string;
  title: string;
  body: string | null;
  active: boolean;
  store_ids: string[];
  acked_count: number;
}

interface StoreOption {
  id: string;
  store_name: string;
}

interface ReceiptUser {
  id?: string;
  display_name?: string | null;
  username?: string | null;
}

interface ReceiptRow {
  id: string;
  acknowledged_at: string | null;
  snoozed_date: string | null;
  user: ReceiptUser | ReceiptUser[] | null;
}

interface EditorState {
  title: string;
  body: string;
  active: boolean;
  storeIds: string[];
}

const EMPTY_EDITOR: EditorState = {
  title: '',
  body: '',
  active: true,
  storeIds: [],
};

function receiptName(user: ReceiptRow['user']): string {
  const u = Array.isArray(user) ? user[0] : user;
  return u?.display_name || u?.username || '—';
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export default function AnnouncementsPage() {
  const t = useTranslations('hr.announcements');

  const [rows, setRows] = useState<Announcement[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // editor modal (create + edit)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);

  // receipts modal
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);

  const failToast = (message?: string) => {
    toast({ type: 'error', title: t('saveFailed'), message });
  };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/announcements');
      if (res.ok) {
        const json = await res.json();
        setRows((json.data ?? []) as Announcement[]);
      } else {
        const json = await res.json().catch(() => ({}));
        failToast(json.error);
      }
    } catch (err) {
      failToast(err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // scope picker source: active stores.
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

  const storeName = (storeId: string): string =>
    stores.find((s) => s.id === storeId)?.store_name ?? storeId;

  const scopeLabel = (storeIds: string[]): string => {
    if (storeIds.length === 0) return t('allStores');
    return storeIds.map(storeName).join(', ');
  };

  const openCreate = () => {
    setEditId(null);
    setEditor(EMPTY_EDITOR);
    setEditorOpen(true);
  };

  const openEdit = (row: Announcement) => {
    setEditId(row.id);
    setEditor({
      title: row.title,
      body: row.body ?? '',
      active: row.active,
      storeIds: row.store_ids ?? [],
    });
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
  };

  const toggleStore = (storeId: string) => {
    setEditor((s) => ({
      ...s,
      storeIds: s.storeIds.includes(storeId)
        ? s.storeIds.filter((id) => id !== storeId)
        : [...s.storeIds, storeId],
    }));
  };

  const saveEditor = async () => {
    const title = editor.title.trim();
    if (!title) {
      toast({ type: 'error', title: t('requiredTitle') });
      return;
    }
    setSaving(true);
    try {
      const isEdit = editId != null;
      const payload: Record<string, unknown> = {
        title,
        body: editor.body,
        storeIds: editor.storeIds,
      };
      if (isEdit) payload.active = editor.active;
      const res = await fetch(
        isEdit ? `/api/hr/announcements/${editId}` : '/api/hr/announcements',
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        failToast(json.error);
        return;
      }
      toast({ type: 'success', title: t('savedOk') });
      setEditorOpen(false);
      await fetchRows();
    } catch (err) {
      failToast(err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: Announcement) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/announcements/${row.id}`, {
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
    } catch (err) {
      failToast(err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const openReceipts = async (row: Announcement) => {
    setReceiptsOpen(true);
    setReceipts([]);
    setReceiptsLoading(true);
    try {
      const res = await fetch(`/api/hr/announcements/${row.id}/receipts`);
      if (res.ok) {
        const json = await res.json();
        setReceipts((json.data ?? []) as ReceiptRow[]);
      } else {
        const json = await res.json().catch(() => ({}));
        failToast(json.error);
      }
    } catch (err) {
      failToast(err instanceof Error ? err.message : undefined);
    } finally {
      setReceiptsLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
        </div>
        <Button size="sm" onClick={openCreate} className="shrink-0">
          <Plus className="h-4 w-4" />
          {t('add')}
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
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-gray-900 dark:text-white">
                    {row.title}
                  </span>
                  <Badge variant={row.active ? 'success' : 'default'} size="sm">
                    {row.active ? t('active') : t('inactive')}
                  </Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                  <span className="truncate">
                    {t('scope')}: {scopeLabel(row.store_ids)}
                  </span>
                  <span className="text-gray-300 dark:text-gray-600">·</span>
                  <span className="tabular-nums">
                    {t('acked')}: {row.acked_count}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => openReceipts(row)}
                disabled={saving}
                title={t('viewReceipts')}
                aria-label={t('viewReceipts')}
                className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-400"
              >
                <Eye className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => openEdit(row)}
                disabled={saving}
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
            </li>
          ))}
        </ul>
      )}

      {/* editor modal */}
      <Modal
        isOpen={editorOpen}
        onClose={closeEditor}
        title={editId ? t('edit') : t('add')}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label={t('name')}
            value={editor.title}
            onChange={(e) => setEditor((s) => ({ ...s, title: e.target.value }))}
            placeholder={t('namePlaceholder')}
            autoFocus
          />
          <Textarea
            label={t('body')}
            value={editor.body}
            onChange={(e) => setEditor((s) => ({ ...s, body: e.target.value }))}
            rows={6}
          />

          {/* scope multi-select — empty selection = all branches */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('scope')}
              </span>
              {editor.storeIds.length === 0 && (
                <span className="text-xs text-gray-400">{t('allStores')}</span>
              )}
            </div>
            {stores.length > 0 && (
              <div className="grid grid-cols-1 gap-1.5 rounded-lg border border-gray-200 p-2 dark:border-gray-700 sm:grid-cols-2">
                {stores.map((store) => (
                  <label
                    key={store.id}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <input
                      type="checkbox"
                      checked={editor.storeIds.includes(store.id)}
                      onChange={() => toggleStore(store.id)}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
                    />
                    <span className="truncate">{store.store_name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {editId && (
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={editor.active}
                onChange={(e) => setEditor((s) => ({ ...s, active: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {t('active')}
            </label>
          )}
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={closeEditor} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button onClick={saveEditor} isLoading={saving}>
            {t('save')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* receipts modal */}
      <Modal
        isOpen={receiptsOpen}
        onClose={() => setReceiptsOpen(false)}
        title={t('viewReceipts')}
        size="lg"
      >
        {receiptsLoading ? (
          <div className="py-10 text-center text-sm text-gray-400">…</div>
        ) : receipts.filter((r) => r.acknowledged_at).length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
            {t('noReceipts')}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {receipts
              .filter((r) => r.acknowledged_at)
              .map((receipt) => (
                <li key={receipt.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
                      {receiptName(receipt.user)}
                    </div>
                    <div className="text-xs text-gray-400">
                      {formatDate(receipt.acknowledged_at)}
                    </div>
                  </div>
                  <Badge variant="success" size="sm">
                    {t('acked')}
                  </Badge>
                </li>
              ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
