'use client';

/**
 * "กลุ่มเงินเดือน" — slices of a company's payroll that get run separately, so two HR users can
 * each own part of it without their people mixing (owner ask 2026-08-11).
 *
 * Distinct from the ลับ flag: the group decides WHICH RUN someone lands in, the flag decides who
 * may SEE their figures. The counts here show both, because a group holding confidential pay can
 * only be run by someone with the grant.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Users, Lock, Layers } from 'lucide-react';
import { Button, Input, Modal, ModalFooter, Select, StatusBadge, useConfirm, toast } from '@/components/ui';

interface Group {
  id: string;
  company_id: string;
  name: string;
  note: string | null;
  employee_count: number;
  confidential_count: number;
}
interface CompanyOpt {
  id: string;
  name: string;
}

export function PayrollGroupsManager() {
  const { confirm, dialog } = useConfirm();
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [ungrouped, setUngrouped] = useState({ total: 0, confidential: 0 });
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

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
    } catch {
      toast({ type: 'error', title: 'โหลดกลุ่มเงินเดือนไม่สำเร็จ' });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!name.trim() || !companyId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/hr/payroll-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, name: name.trim(), note: note.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'สร้างไม่สำเร็จ');
      toast({ type: 'success', title: `สร้างกลุ่ม "${name.trim()}" แล้ว` });
      setAddOpen(false);
      setName('');
      setNote('');
      await load();
    } catch (e) {
      toast({ type: 'error', title: e instanceof Error ? e.message : 'สร้างไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (g: Group) => {
    const ok = await confirm({
      title: `ลบกลุ่ม "${g.name}"?`,
      message:
        g.employee_count > 0
          ? `พนักงาน ${g.employee_count} คนจะกลับไปอยู่กลุ่ม "ยังไม่จัดกลุ่ม" — ไม่มีใครหายไป`
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

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
          className="min-w-[16rem]"
        />
        <div className="flex-1" />
        <Button size="sm" onClick={() => setAddOpen(true)} disabled={!companyId}>
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
                    <StatusBadge tone="warn" label={`ลับ ${g.confidential_count} คน — ต้องมีสิทธิ์จึงทำงวดได้`} />
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(g)}
                title="ลบกลุ่ม"
                className="cursor-pointer rounded p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          {/* The default slice always exists — it is what a payrun with no group covers. */}
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60 p-3 dark:border-gray-600 dark:bg-gray-800/40">
            <p className="font-medium text-gray-600 dark:text-gray-300">ยังไม่จัดกลุ่ม</p>
            <p className="text-xs text-gray-400">คนที่ไม่ได้อยู่กลุ่มไหน — รวมอยู่ในงวดปกติของบริษัท</p>
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

      <Modal isOpen={addOpen} onClose={() => setAddOpen(false)} title="สร้างกลุ่มเงินเดือน" size="sm">
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
          <p className="text-xs text-gray-400">
            สร้างกลุ่มแล้วไปกำหนดสมาชิกที่ฟอร์มแก้ไขพนักงาน (ช่อง &quot;กลุ่มเงินเดือน&quot;)
          </p>
        </div>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setAddOpen(false)} disabled={saving}>
            ยกเลิก
          </Button>
          <Button size="sm" onClick={create} disabled={!name.trim() || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            สร้าง
          </Button>
        </ModalFooter>
      </Modal>
      {dialog}
    </div>
  );
}
