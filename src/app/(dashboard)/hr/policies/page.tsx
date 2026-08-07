'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Users, Eye, FileText, CheckCircle2, CircleSlash } from 'lucide-react';
import {
  Button,
  Badge,
  Input,
  Textarea,
  Modal,
  ModalFooter,
  PageHeader,
  ViewToggle,
  useViewMode,
  KpiRow,
  StatTile,
  StatusBadge,
  DataCard,
  DataList,
  toast,
} from '@/components/ui';
import { STOCK_SOP_CATEGORY } from '@/lib/stock/penalty-engine';
import { employeeNameLabel } from '@/lib/hr/employee-name';

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
  full_name?: string | null;
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
  return employeeNameLabel(u);
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export default function PoliciesPage() {
  const t = useTranslations('hr.policies');
  const tForm = useTranslations('hr.employees.form');

  const [rows, setRows] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useViewMode('hr-policies');

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
        // The stock SOP is managed on the HQ page (/stock/penalties), not here — hide it.
        setRows(((json.data ?? []) as Policy[]).filter((p) => p.category !== STOCK_SOP_CATEGORY));
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

  const viewSignature = async (path: string) => {
    try {
      const res = await fetch(`/api/hr/documents?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.url) window.open(json.url, '_blank');
      } else {
        const json = await res.json().catch(() => ({}));
        failToast(json.error);
      }
    } catch (err) {
      failToast(err instanceof Error ? err.message : undefined);
    }
  };

  const activeCount = rows.filter((r) => r.active).length;
  const inactiveCount = rows.length - activeCount;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <ViewToggle value={view} onChange={setView} />
            <Button size="sm" onClick={openCreate} className="shrink-0">
              <Plus className="h-4 w-4" />
              {t('add')}
            </Button>
          </>
        }
      />

      {/* key figures — lead with the policy counts */}
      {!loading && rows.length > 0 && (
        <KpiRow cols={3}>
          <StatTile label={t('title')} value={rows.length} icon={FileText} tone="accent" />
          <StatTile label={t('active')} value={activeCount} icon={CheckCircle2} tone="good" />
          <StatTile label={t('inactive')} value={inactiveCount} icon={CircleSlash} tone="default" />
        </KpiRow>
      )}

      {/* list */}
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
          {t('empty')}
        </div>
      ) : (
        <DataList compact={view === 'compact'}>
          {rows.map((row) => (
            <DataCard
              key={row.id}
              accent={row.active ? 'good' : 'neutral'}
              title={<span className="truncate">{row.title}</span>}
              status={
                <StatusBadge
                  tone={row.active ? 'good' : 'neutral'}
                  label={row.active ? t('active') : t('inactive')}
                />
              }
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => openAcks(row)}
                    disabled={saving}
                    title={t('viewAcks')}
                    aria-label={t('viewAcks')}
                    className="shrink-0 rounded-md p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-400"
                  >
                    <Users className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    disabled={saving}
                    title={t('edit')}
                    aria-label={t('edit')}
                    className="shrink-0 rounded-md p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-400"
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
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default" size="sm">v{row.version}</Badge>
                {row.category && <span>{row.category}</span>}
              </div>
            </DataCard>
          ))}
        </DataList>
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
                <div className="flex shrink-0 items-center gap-2">
                  {ack.signature_path && (
                    <button
                      type="button"
                      onClick={() => viewSignature(ack.signature_path as string)}
                      title={tForm('docView')}
                      aria-label={tForm('docView')}
                      className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800 dark:hover:text-indigo-400"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  )}
                  <Badge variant="default" size="sm">
                    v{ack.policy_version}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
