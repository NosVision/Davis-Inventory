'use client';

/**
 * "กลุ่มเงินเดือน" — slices of a company's payroll that get run separately, so two HR users can
 * each own part of it without their people mixing (owner ask 2026-08-11).
 *
 * Each group names WHO MAY MANAGE IT (owner ask 2026-08-26). A group with managers is restricted:
 * only they — plus holders of "ดูเงินเดือนได้ทุกคน" — may see its members' pay or build its payrun.
 * A group with nobody named is open to every HR user, which is why the card says so out loud
 * instead of leaving it blank: "no restriction" and "restriction you cannot see" look identical
 * otherwise, and that was the complaint this screen was rebuilt to answer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, Users, Lock, Layers, ShieldCheck, Pencil, Globe } from 'lucide-react';
import { Button, Input, Modal, ModalFooter, Select, StatusBadge, useConfirm, toast } from '@/components/ui';

interface Manager {
  user_id: string;
  name: string;
  nickname: string | null;
  role: string | null;
}
interface Group {
  id: string;
  company_id: string;
  name: string;
  note: string | null;
  employee_count: number;
  confidential_count: number;
  managers: Manager[];
}
interface CompanyOpt {
  id: string;
  name: string;
}

/** "สมชาย (เมย์)" — the project-wide way of naming a person on screen. */
function personLabel(m: Manager): string {
  return m.nickname ? `${m.name} (${m.nickname})` : m.name;
}

/** Checkbox list of the HR users who may own a slice. Small enough that a picker would be worse. */
function ManagerPicker({
  candidates,
  selected,
  onToggle,
  disabled,
}: {
  candidates: Manager[];
  selected: ReadonlySet<string>;
  onToggle: (userId: string) => void;
  disabled: boolean;
}) {
  if (candidates.length === 0) {
    return <p className="text-xs text-gray-400">ยังไม่มีผู้ใช้ที่จัดการงานบุคคลได้ในระบบ</p>;
  }
  return (
    <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border border-gray-200 p-1 dark:border-gray-700">
      {candidates.map((c) => (
        <label
          key={c.user_id}
          className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
            disabled ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            checked={selected.has(c.user_id)}
            onChange={() => onToggle(c.user_id)}
            disabled={disabled}
          />
          <span className="truncate text-gray-800 dark:text-gray-100">{personLabel(c)}</span>
          {c.role && <span className="ml-auto shrink-0 text-[10px] uppercase text-gray-400">{c.role}</span>}
        </label>
      ))}
    </div>
  );
}

export function PayrollGroupsManager() {
  const { confirm, dialog } = useConfirm();
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [ungrouped, setUngrouped] = useState({ total: 0, confidential: 0 });
  const [candidates, setCandidates] = useState<Manager[]>([]);
  const [canEditManagers, setCanEditManagers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // One modal for both create and edit — `editing` null means "creating".
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [managerIds, setManagerIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/companies');
        const json = await res.json().catch(() => ({}));
        const list = (json.data ?? []) as CompanyOpt[];
        setCompanies(list);
        setCompanyId((prev) => prev || list[0]?.id || '');
      } catch {
        setCompanies([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/payroll-groups?company_id=${companyId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error);
      setGroups((json.data?.groups ?? []) as Group[]);
      setUngrouped(json.data?.ungrouped ?? { total: 0, confidential: 0 });
      setCandidates((json.data?.candidates ?? []) as Manager[]);
      setCanEditManagers(Boolean(json.data?.can_edit_managers));
    } catch {
      toast({ type: 'error', title: 'โหลดกลุ่มเงินเดือนไม่สำเร็จ' });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  // Whoever may edit manager lists is also the person who files ภ.ง.ด.1 / สปส. for the whole
  // company — no single group's manager can produce those. Naming them here is the honest version
  // of "your group is private": private from the other HR users, not from the person filing tax.
  const documentIssuers = useMemo(
    () => candidates.filter((c) => c.role === 'owner' || c.role === 'hr'),
    [candidates]
  );

  const openCreate = () => {
    setEditing(null);
    setName('');
    setNote('');
    setManagerIds(new Set());
    setFormOpen(true);
  };

  const openEdit = (g: Group) => {
    setEditing(g);
    setName(g.name);
    setNote(g.note ?? '');
    setManagerIds(new Set(g.managers.map((m) => m.user_id)));
    setFormOpen(true);
  };

  const toggleManager = (userId: string) =>
    setManagerIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const save = async () => {
    if (!name.trim() || !companyId) return;
    setSaving(true);
    try {
      const managerPayload = canEditManagers ? { manager_ids: [...managerIds] } : {};
      const res = editing
        ? await fetch('/api/hr/payroll-groups', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: editing.id, name: name.trim(), note: note.trim() || null, ...managerPayload }),
          })
        : await fetch('/api/hr/payroll-groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_id: companyId,
              name: name.trim(),
              note: note.trim() || undefined,
              ...managerPayload,
            }),
          });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'บันทึกไม่สำเร็จ');
      if (json.warning) toast({ type: 'error', title: json.warning });
      else toast({ type: 'success', title: editing ? 'บันทึกแล้ว' : `สร้างกลุ่ม "${name.trim()}" แล้ว` });
      setFormOpen(false);
      await load();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (g: Group) => {
    const ok = await confirm({
      title: `ลบกลุ่ม "${g.name}"?`,
      message:
        g.employee_count > 0
          ? `พนักงาน ${g.employee_count} คนจะกลับไปอยู่กลุ่ม "ยังไม่จัดกลุ่ม" — ไม่มีใครหายไป${
              g.managers.length > 0 ? ' และเงินเดือนของพวกเขาจะกลับมาให้ HR ทุกคนเห็น' : ''
            }`
          : 'กลุ่มนี้ยังไม่มีสมาชิก',
      tone: 'danger',
      confirmLabel: 'ลบกลุ่ม',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/hr/payroll-groups?id=${g.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'ลบไม่สำเร็จ');
      toast({ type: 'success', title: 'ลบกลุ่มแล้ว' });
      await load();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : 'ลบไม่สำเร็จ' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2.5 text-xs text-indigo-800 dark:border-indigo-800/60 dark:bg-indigo-900/15 dark:text-indigo-300">
        <Layers className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          แบ่งเงินเดือนของบริษัทหนึ่งออกเป็นหลายงวดที่ทำแยกกัน — <span className="font-semibold">แต่ละกลุ่มได้งวดของตัวเอง
          และไฟล์โอนเงินของตัวเอง</span> คนที่ยังไม่จัดกลุ่มจะรวมอยู่ในงวด &quot;ยังไม่จัดกลุ่ม&quot; เหมือนเดิม ·
          เอกสาร ภ.ง.ด.1 / สปส. ยังรวมทุกงวดของบริษัทให้ครบตามกฎหมาย
        </p>
      </div>

      {documentIssuers.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/15 dark:text-amber-300">
          <Globe className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            เอกสารระดับบริษัท (ภ.ง.ด.1 / สปส. / ทะเบียนค่าจ้าง / 50 ทวิ) ต้องมีพนักงาน<span className="font-semibold">ครบทุกคนทุกกลุ่ม</span>ตามกฎหมาย
            ผู้จัดการกลุ่มออกเองไม่ได้ — ออกโดย{' '}
            <span className="font-semibold">{documentIssuers.map(personLabel).join(', ')}</span>{' '}
            ซึ่งจึงเห็นเงินเดือนของทุกกลุ่ม
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
          className="min-w-[16rem]"
        />
        <div className="flex-1" />
        <Button size="sm" onClick={openCreate} disabled={!companyId}>
          <Plus className="h-4 w-4" /> สร้างกลุ่ม
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div
              key={g.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-white">{g.name}</p>
                {g.note && <p className="text-xs text-gray-400">{g.note}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400">
                    <Users className="h-3 w-3" /> {g.employee_count} คน
                  </span>
                  {g.confidential_count > 0 && (
                    <StatusBadge tone="warn" label={`ลับ ${g.confidential_count} คน`} />
                  )}
                </div>
                {/* The answer to "who can touch this?" — never left blank. */}
                <p className="mt-1.5 flex items-start gap-1 text-xs">
                  {g.managers.length > 0 ? (
                    <>
                      <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-gray-600 dark:text-gray-300">
                        จัดการโดย{' '}
                        <span className="font-medium text-gray-900 dark:text-white">
                          {g.managers.map(personLabel).join(', ')}
                        </span>{' '}
                        — คนอื่นไม่เห็นเงินเดือนของกลุ่มนี้และทำงวดไม่ได้
                      </span>
                    </>
                  ) : (
                    <>
                      <Users className="mt-0.5 h-3 w-3 shrink-0 text-gray-400" />
                      <span className="text-gray-500 dark:text-gray-400">
                        <span className="font-medium">HR ทุกคนจัดการได้</span> — ยังไม่ได้ระบุผู้จัดการกลุ่มนี้
                      </span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => openEdit(g)}
                  title="แก้ไขกลุ่ม / ผู้จัดการ"
                  className="cursor-pointer rounded p-1.5 text-gray-300 transition-colors hover:bg-indigo-50 hover:text-indigo-500 dark:hover:bg-indigo-900/30"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(g)}
                  title="ลบกลุ่ม"
                  className="cursor-pointer rounded p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          {/* The default slice always exists — it is what a payrun with no group covers. */}
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60 p-3 dark:border-gray-600 dark:bg-gray-800/40">
            <p className="font-medium text-gray-600 dark:text-gray-300">ยังไม่จัดกลุ่ม</p>
            <p className="text-xs text-gray-400">
              คนที่ไม่ได้อยู่กลุ่มไหน — รวมอยู่ในงวดปกติของบริษัท และ HR ทุกคนทำงวดนี้ได้
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400">
                <Users className="h-3 w-3" /> {ungrouped.total} คน
              </span>
              {ungrouped.confidential > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Lock className="h-3 w-3" /> ลับ {ungrouped.confidential} คน
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `แก้ไขกลุ่ม "${editing.name}"` : 'สร้างกลุ่มเงินเดือน'}
        size="sm"
      >
        <div className="space-y-3">
          <Input
            label="ชื่อกลุ่ม"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น ทีมบัญชี"
          />
          <Input
            label="หมายเหตุ (ไม่บังคับ)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น เมย์เป็นผู้ทำงวดนี้"
          />

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">ใครจัดการกลุ่มนี้ได้</p>
            <ManagerPicker
              candidates={candidates}
              selected={managerIds}
              onToggle={toggleManager}
              disabled={!canEditManagers}
            />
            <p className="text-xs text-gray-400">
              {!canEditManagers
                ? 'คุณไม่มีสิทธิ์ "ดูเงินเดือนได้ทุกคน" จึงกำหนดผู้จัดการกลุ่มไม่ได้'
                : managerIds.size === 0
                  ? 'ไม่เลือกใคร = HR ทุกคนทำงวดนี้ได้และเห็นเงินเดือนของกลุ่มนี้'
                  : 'เฉพาะคนที่เลือกเท่านั้นที่เห็นเงินเดือนและทำงวดของกลุ่มนี้ได้'}
            </p>
          </div>

          {!editing && (
            <p className="text-xs text-gray-400">
              สร้างกลุ่มแล้วไปกำหนดสมาชิกที่ฟอร์มแก้ไขพนักงาน (ช่อง &quot;กลุ่มเงินเดือน&quot;)
            </p>
          )}
        </div>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)} disabled={saving}>
            ยกเลิก
          </Button>
          <Button size="sm" onClick={save} disabled={!name.trim() || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? 'บันทึก' : 'สร้าง'}
          </Button>
        </ModalFooter>
      </Modal>
      {dialog}
    </div>
  );
}
