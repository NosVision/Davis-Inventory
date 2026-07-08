'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Copy, Check, Plus, Pencil, Trash2, Save, X } from 'lucide-react';
import { Button, toast } from '@/components/ui';

interface Template {
  id: string;
  name: string;
  body: string;
}

// Shown on the "employee created" screen (owner ask 2026-07-08): the credentials + a copyable
// LINE hand-off message built from CRUD-able templates. Placeholders {name}/{username}/{password}/
// {loginUrl} are filled here. Templates are managed via /api/hr/message-templates.
export function CredentialShare({
  username, password, displayName, warnings,
}: {
  username: string;
  password: string;
  displayName: string;
  warnings: string[];
}) {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { created: 'สร้างบัญชีสำเร็จ', credsHint: 'ส่งข้อมูลนี้ให้พนักงานเพื่อเข้าสู่ระบบ', user: 'ผู้ใช้', pass: 'รหัสผ่าน', template: 'เทมเพลตข้อความ', message: 'ข้อความ (แก้ก่อนคัดลอกได้)', copy: 'คัดลอกข้อความ', copied: 'คัดลอกแล้ว', copyCreds: 'คัดลอก', manage: 'จัดการเทมเพลต', addNew: 'เพิ่มเทมเพลต', name: 'ชื่อเทมเพลต', body: 'เนื้อหา', save: 'บันทึก', cancel: 'ยกเลิก', del: 'ลบ', confirmDel: 'ลบเทมเพลตนี้?', saved: 'บันทึกแล้ว', deleted: 'ลบแล้ว', fail: 'ไม่สำเร็จ', noTemplates: 'ยังไม่มีเทมเพลต', placeholderHint: 'ใช้ตัวแปร: {name} {username} {password} {loginUrl}' }
    : { created: 'Account created', credsHint: 'Send these to the employee so they can log in', user: 'Username', pass: 'Password', template: 'Message template', message: 'Message (edit before copying)', copy: 'Copy message', copied: 'Copied', copyCreds: 'Copy', manage: 'Manage templates', addNew: 'Add template', name: 'Template name', body: 'Body', save: 'Save', cancel: 'Cancel', del: 'Delete', confirmDel: 'Delete this template?', saved: 'Saved', deleted: 'Deleted', fail: 'Failed', noTemplates: 'No templates yet', placeholderHint: 'Variables: {name} {username} {password} {loginUrl}' };

  const loginUrl = useMemo(() => (typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login'), []);
  const fill = useCallback(
    (b: string) => b
      .replaceAll('{name}', displayName || username)
      .replaceAll('{username}', username)
      .replaceAll('{password}', password)
      .replaceAll('{loginUrl}', loginUrl),
    [displayName, username, password, loginUrl]
  );

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [managing, setManaging] = useState(false);
  // editor: null closed, 'new' creating, otherwise the id being edited
  const [editorId, setEditorId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editBody, setEditBody] = useState('');
  const [busy, setBusy] = useState(false);

  const loadTemplates = useCallback(async (selectFirst: boolean) => {
    try {
      const res = await fetch('/api/hr/message-templates');
      if (!res.ok) return;
      const list = ((await res.json()).data ?? []) as Template[];
      setTemplates(list);
      if (selectFirst && list.length > 0) {
        setSelectedId((cur) => cur || list[0].id);
      }
    } catch { /* templates are optional — credentials still copyable */ }
  }, []);

  useEffect(() => { loadTemplates(true); }, [loadTemplates]);

  // Re-render the message whenever the selected template changes.
  useEffect(() => {
    const tpl = templates.find((t) => t.id === selectedId);
    if (tpl) setMessage(fill(tpl.body));
  }, [selectedId, templates, fill]);

  const copy = async (text: string, markMessage = false) => {
    try {
      await navigator.clipboard.writeText(text);
      if (markMessage) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
      toast({ type: 'success', title: L.copied });
    } catch { toast({ type: 'error', title: L.fail }); }
  };

  const openNew = () => { setEditorId('new'); setEditName(''); setEditBody(''); };
  const openEdit = (t: Template) => { setEditorId(t.id); setEditName(t.name); setEditBody(t.body); };
  const closeEditor = () => { setEditorId(null); setEditName(''); setEditBody(''); };

  const saveEditor = async () => {
    if (!editName.trim() || !editBody.trim()) { toast({ type: 'error', title: L.fail }); return; }
    setBusy(true);
    try {
      const isNew = editorId === 'new';
      const res = await fetch(isNew ? '/api/hr/message-templates' : `/api/hr/message-templates/${editorId}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), body: editBody }),
      });
      if (!res.ok) throw new Error();
      const saved = (await res.json()).data as Template;
      toast({ type: 'success', title: L.saved });
      closeEditor();
      await loadTemplates(false);
      if (saved?.id) setSelectedId(saved.id);
    } catch { toast({ type: 'error', title: L.fail }); }
    finally { setBusy(false); }
  };

  const del = async (id: string) => {
    if (!window.confirm(L.confirmDel)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/message-templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast({ type: 'success', title: L.deleted });
      if (selectedId === id) setSelectedId('');
      await loadTemplates(true);
    } catch { toast({ type: 'error', title: L.fail }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* Credentials */}
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-700 dark:bg-emerald-900/20">
        <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{L.created}</p>
        <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">{L.credsHint}</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[{ k: L.user, v: username }, { k: L.pass, v: password }].map(({ k, v }) => (
            <div key={k} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 dark:bg-gray-900">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-gray-400">{k}</p>
                <p className="select-all truncate font-mono text-sm font-bold text-gray-900 dark:text-white">{v || '—'}</p>
              </div>
              <button type="button" onClick={() => copy(v)} title={L.copyCreds}
                className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700">
                <Copy className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        {warnings.length > 0 && (
          <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-amber-600 dark:text-amber-400">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </div>

      {/* Message + template picker */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{L.template}</label>
          <button type="button" onClick={() => setManaging((m) => !m)}
            className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">{L.manage}</button>
        </div>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="control w-full">
          {templates.length === 0 && <option value="">{L.noTemplates}</option>}
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{L.message}</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={7} className="control w-full font-mono text-sm" />
        <Button type="button" onClick={() => copy(message, true)} disabled={!message.trim()}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? L.copied : L.copy}
        </Button>
      </div>

      {/* Template management */}
      {managing && (
        <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">{L.manage}</span>
            <Button type="button" size="sm" variant="outline" onClick={openNew} disabled={editorId === 'new'}>
              <Plus className="h-3.5 w-3.5" />{L.addNew}
            </Button>
          </div>

          {editorId === 'new' && (
            <TemplateEditor
              name={editName} body={editBody} busy={busy} labels={L}
              onName={setEditName} onBody={setEditBody} onSave={saveEditor} onCancel={closeEditor}
            />
          )}

          <ul className="divide-y divide-gray-100 dark:divide-gray-700/70">
            {templates.map((t) => (
              <li key={t.id} className="py-2">
                {editorId === t.id ? (
                  <TemplateEditor
                    name={editName} body={editBody} busy={busy} labels={L}
                    onName={setEditName} onBody={setEditBody} onSave={saveEditor} onCancel={closeEditor}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200">{t.name}</span>
                    <button type="button" onClick={() => openEdit(t)} title={L.save}
                      className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-700"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={() => del(t.id)} disabled={busy} title={L.del}
                      className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-50 dark:hover:bg-gray-700"><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-gray-400">{L.placeholderHint}</p>
        </div>
      )}
    </div>
  );
}

function TemplateEditor({
  name, body, busy, labels, onName, onBody, onSave, onCancel,
}: {
  name: string; body: string; busy: boolean;
  labels: { name: string; body: string; save: string; cancel: string; placeholderHint: string };
  onName: (v: string) => void; onBody: (v: string) => void; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg bg-gray-50 p-2.5 dark:bg-gray-800/50">
      <input value={name} onChange={(e) => onName(e.target.value)} placeholder={labels.name} className="control w-full text-sm" />
      <textarea value={body} onChange={(e) => onBody(e.target.value)} placeholder={labels.body} rows={5} className="control w-full font-mono text-sm" />
      <p className="text-[11px] text-gray-400">{labels.placeholderHint}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}><X className="h-3.5 w-3.5" />{labels.cancel}</Button>
        <Button type="button" size="sm" onClick={onSave} isLoading={busy}><Save className="h-3.5 w-3.5" />{labels.save}</Button>
      </div>
    </div>
  );
}
