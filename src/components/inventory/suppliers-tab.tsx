'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2, Pencil, Phone } from 'lucide-react';
import { Button, Input, Modal, ModalFooter, toast } from '@/components/ui';
import type { InvSupplier } from '@/types/inventory';

export function SuppliersTab({ isMgmt }: { isMgmt: boolean }) {
  const [suppliers, setSuppliers] = useState<InvSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<InvSupplier | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/inventory/suppliers');
      const d = await res.json();
      if (res.ok) setSuppliers(d.suppliers ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      {isMgmt && (
        <div className="flex justify-end">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>เพิ่มซัพพลายเออร์</Button>
        </div>
      )}
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
      ) : suppliers.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">ยังไม่มีซัพพลายเออร์</p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {suppliers.map((s) => (
            <li key={s.id} className="flex items-center gap-3 bg-white px-4 py-2.5 dark:bg-gray-800">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-gray-900 dark:text-white">{s.name}</span>
                  {!s.active && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700">ปิดใช้</span>}
                </div>
                {(s.phone || s.contact) && (
                  <p className="flex items-center gap-1 text-xs text-gray-400">
                    {s.phone && <><Phone className="h-3 w-3" /> {s.phone}</>}
                    {s.contact ? ` · ${s.contact}` : ''}
                  </p>
                )}
              </div>
              {isMgmt && (
                <button onClick={() => setEditing(s)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <SupplierModal supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function SupplierModal({ supplier, onClose, onSaved }: { supplier: InvSupplier | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!supplier;
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [contact, setContact] = useState(supplier?.contact ?? '');
  const [note, setNote] = useState(supplier?.note ?? '');
  const [active, setActive] = useState(supplier?.active ?? true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast({ type: 'error', title: 'ต้องระบุชื่อ' });
    setSaving(true);
    try {
      const res = await fetch(isEdit ? `/api/inventory/suppliers/${supplier!.id}` : '/api/inventory/suppliers', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone, contact, note, ...(isEdit ? { active } : {}) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'บันทึกไม่สำเร็จ');
      toast({ type: 'success', title: isEdit ? 'บันทึกแล้ว' : 'เพิ่มแล้ว' });
      onSaved();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'แก้ไขซัพพลายเออร์' : 'เพิ่มซัพพลายเออร์'} size="sm">
      <div className="space-y-3">
        <Input label="ชื่อ *" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น บจก. เครื่องดื่มไทย" />
        <Input label="เบอร์โทร" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input label="ผู้ติดต่อ" value={contact} onChange={(e) => setContact(e.target.value)} />
        <Input label="หมายเหตุ" value={note} onChange={(e) => setNote(e.target.value)} />
        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded" /> เปิดใช้งาน
          </label>
        )}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={submit} isLoading={saving}>{isEdit ? 'บันทึก' : 'เพิ่ม'}</Button>
      </ModalFooter>
    </Modal>
  );
}
