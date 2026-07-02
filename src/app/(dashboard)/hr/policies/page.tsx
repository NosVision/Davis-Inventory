'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Users } from 'lucide-react';
import { Button, Badge, Input, Textarea, Modal, ModalFooter, toast } from '@/components/ui';

interface Policy {
  id: string;
  title: string;
  category: string | null;
  body: string | null;
  version: number;
  active: boolean;
  sort_order?: number;
}

interface AckUser {
  id?: string;
  display_name?: string | null;
  username?: string | null;
}

interface AckRow {
  id: string;
  policy_version: number;
  acked_at: string | null;
  signature_path: string | null;
  user: AckUser | AckUser[] | null;
}

interface EditorState {
  title: string;
  category: string;
  body: string;
  active: boolean;
  bumpVersion: boolean;
}

const EMPTY_EDITOR: EditorState = {
  title: '',
  category: '',
  body: '',
  active: true,
  bumpVersion: false,
};

function ackName(user: AckRow['user']): string {
  const u = Array.isArray(user) ? user[0] : user;
  return u?.display_name || u?.username || '—';
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export default function PoliciesPage() {
  const t = useTranslations('hr.policies');

  const [rows, setRows] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // editor modal (create + edit)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);

  // acknowledgements modal
  const [acksOpen, setAcksOpen] = useState(false);
  const [acksLoading, setAcksLoading] = useState(false);
  const [acks, setAcks] = useState<AckRow[]>([]);

  const failToast = (message?: string) => {
    toast({ type: 'error', title: t('saveFailed'), message });
  };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/policies');
      if (res.ok) {
        const json = await res.json();
        setRows((json.data ?? []) as Policy[]);
      } else {
        const json = await res.json().catch(() => ({}));
        toast({ type: 'error', title: t('saveFailed'), message: json.error });
      }
    } catch (err) {
      toast({
        type: 'error',
        title: t('saveFailed'),
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const openCreate = () => {
    setEditId(null);
    setEditor(EMPTY_EDITOR);
    setEditorOpen(true);
  };

  const openEdit = (row: Policy) => {
    setEditId(row.id);
    setEditor({
      title: row.title,
      category: row.category ?? '',
      body: row.body ?? '',
      active: row.active,
      bumpVersion: false,
    });
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
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
        category: editor.category.trim(),
        body: editor.body,
      };
      if (isEdit) {
        payload.active = editor.active;
        payload.bumpVersion = editor.bumpVersion;
      }
      const res = await fetch(isEdit ? `/api/hr/policies/${editId}` : '/api/hr/policies', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
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

  const toggleActive = async (row: Policy) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/policies/${row.id}`, {
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

  const openAcks = async (row: Policy) => {
    setAcksOpen(true);
    setAcks([]);
    setAcksLoading(true);
    try {
      const res = await fetch(`/api/hr/policies/${row.id}/acks`);
      if (res.ok) {
        const json = await res.json();
        setAcks((json.data ?? []) as AckRow[]);
      } else {
        const json = await res.json().catch(() => ({}));
        failToast(json.error);
      }
    } catch (err) {
      failToast(err instanceof Error ? err.message : undefined);
    } finally {
      setAcksLoading(false);
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
                  <span className="shrink-0 text-xs tabular-nums text-gray-400">
                    v{row.version}
                  </span>
                  <Badge variant={row.active ? 'success' : 'default'} size="sm">
                    {row.active ? t('active') : t('inactive')}
                  </Badge>
                </div>
                {row.category && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">{row.category}</span>
                )}
              </div>

              <button
                type="button"
                onClick={() => openAcks(row)}
                disabled={saving}
                title={t('viewAcks')}
                aria-label={t('viewAcks')}
                className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-400"
              >
                <Users className="h-4 w-4" />
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
      <Modal isOpen={editorOpen} onClose={closeEditor} title={editId ? t('edit') : t('add')} size="lg">
        <div className="space-y-4">
          <Input
            label={t('name')}
            value={editor.title}
            onChange={(e) => setEditor((s) => ({ ...s, title: e.target.value }))}
            placeholder={t('namePlaceholder')}
            autoFocus
          />
          <Input
            label={t('category')}
            value={editor.category}
            onChange={(e) => setEditor((s) => ({ ...s, category: e.target.value }))}
            placeholder={t('categoryPlaceholder')}
          />
          <Textarea
            label={t('body')}
            value={editor.body}
            onChange={(e) => setEditor((s) => ({ ...s, body: e.target.value }))}
            rows={8}
          />
          {editId && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={editor.active}
                  onChange={(e) => setEditor((s) => ({ ...s, active: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
                />
                {t('active')}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={editor.bumpVersion}
                  onChange={(e) => setEditor((s) => ({ ...s, bumpVersion: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
                />
                {t('bumpVersion')}
              </label>
            </div>
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

      {/* acknowledgements modal */}
      <Modal isOpen={acksOpen} onClose={() => setAcksOpen(false)} title={t('viewAcks')} size="lg">
        {acksLoading ? (
          <div className="py-10 text-center text-sm text-gray-400">…</div>
        ) : acks.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
            {t('noAcks')}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {acks.map((ack) => (
              <li key={ack.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {ackName(ack.user)}
                  </div>
                  <div className="text-xs text-gray-400">{formatDate(ack.acked_at)}</div>
                </div>
                <Badge variant="default" size="sm">
                  v{ack.policy_version}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
