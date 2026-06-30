'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2, Pencil, Trash2 } from 'lucide-react';
import { Button, Input, Select, Modal, ModalFooter, toast } from '@/components/ui';
import { formatBaht, bahtToSatang } from '@/lib/pos/money';
import type { InvProduct } from '@/types/inventory';
import type { ModifierGroupWithOptions, PosModifierOption } from '@/types/pos';

export function ModifierManager({ storeId, isManager }: { storeId: string; isManager: boolean }) {
  const [groups, setGroups] = useState<ModifierGroupWithOptions[]>([]);
  const [loading, setLoading] = useState(true);
  const [editGroup, setEditGroup] = useState<ModifierGroupWithOptions | 'new' | null>(null);
  const [editOption, setEditOption] = useState<{ groupId: string; option: PosModifierOption | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/modifier-groups?storeId=${storeId}`);
      const d = await res.json();
      if (res.ok) setGroups(d.groups ?? []);
    } finally {
      setLoading(false);
    }
  }, [storeId]);
  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">กลุ่มตัวเลือก (เช่น ความเผ็ด, ท็อปปิ้ง) แล้วผูกเข้าเมนูในแท็บ “เมนู + สูตร”</p>
      {isManager && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditGroup('new')}>เพิ่มกลุ่มตัวเลือก</Button>}

      {groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">ยังไม่มีกลุ่มตัวเลือก</p>
      ) : (
        groups.map((g) => (
          <div key={g.id} className="rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2 dark:border-gray-700">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{g.name}</span>
                <span className="ml-2 text-[11px] text-gray-400">
                  {g.max_select <= 1 ? 'เลือก 1' : `เลือกได้ถึง ${g.max_select}`}
                  {g.required ? ' · บังคับ' : ''}
                </span>
              </div>
              {isManager && (
                <button onClick={() => setEditGroup(g)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><Pencil className="h-4 w-4" /></button>
              )}
            </div>
            <ul className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {(g.options ?? []).map((o) => (
                <li key={o.id} className="flex items-center gap-2 px-4 py-1.5 text-sm">
                  <span className="flex-1 text-gray-800 dark:text-gray-200">{o.name}</span>
                  {o.price_satang > 0 && <span className="font-mono text-xs text-indigo-600">+฿{formatBaht(o.price_satang)}</span>}
                  {o.inv_product_id && <span className="text-[10px] text-emerald-600">ตัดสต๊อก</span>}
                  {isManager && (
                    <button onClick={() => setEditOption({ groupId: g.id, option: o })} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><Pencil className="h-3.5 w-3.5" /></button>
                  )}
                </li>
              ))}
            </ul>
            {isManager && (
              <button onClick={() => setEditOption({ groupId: g.id, option: null })} className="w-full border-t border-gray-100 px-4 py-2 text-left text-xs font-medium text-indigo-600 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                + เพิ่มตัวเลือก
              </button>
            )}
          </div>
        ))
      )}

      {editGroup && <GroupModal storeId={storeId} group={editGroup} onClose={() => setEditGroup(null)} onSaved={() => { setEditGroup(null); load(); }} />}
      {editOption && <OptionModal groupId={editOption.groupId} option={editOption.option} onClose={() => setEditOption(null)} onSaved={() => { setEditOption(null); load(); }} />}
    </div>
  );
}

function GroupModal({ storeId, group, onClose, onSaved }: { storeId: string; group: ModifierGroupWithOptions | 'new'; onClose: () => void; onSaved: () => void }) {
  const isEdit = group !== 'new';
  const g = isEdit ? (group as ModifierGroupWithOptions) : null;
  const [name, setName] = useState(g?.name ?? '');
  const [multi, setMulti] = useState((g?.max_select ?? 1) > 1);
  const [maxSelect, setMaxSelect] = useState(String(g?.max_select ?? 1));
  const [required, setRequired] = useState(g?.required ?? false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast({ type: 'error', title: 'ต้องระบุชื่อกลุ่ม' });
    setSaving(true);
    try {
      const max = multi ? Math.max(2, Number(maxSelect) || 2) : 1;
      const body = isEdit
        ? { name: name.trim(), maxSelect: max, minSelect: required ? 1 : 0, required }
        : { storeId, name: name.trim(), maxSelect: max, minSelect: required ? 1 : 0, required };
      const res = await fetch(isEdit ? `/api/pos/modifier-groups/${g!.id}` : '/api/pos/modifier-groups', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'บันทึกไม่สำเร็จ');
      onSaved();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!isEdit || !window.confirm('ลบกลุ่มนี้? (ตัวเลือกในกลุ่มและการผูกกับเมนูจะถูกลบ)')) return;
    await fetch(`/api/pos/modifier-groups/${g!.id}`, { method: 'DELETE' });
    onSaved();
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'แก้กลุ่มตัวเลือก' : 'เพิ่มกลุ่มตัวเลือก'} size="sm">
      <div className="space-y-3">
        <Input label="ชื่อกลุ่ม" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ความเผ็ด, ท็อปปิ้ง" />
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="h-4 w-4 rounded" /> เลือกได้หลายอัน
        </label>
        {multi && <Input label="เลือกได้สูงสุด (อัน)" value={maxSelect} onChange={(e) => setMaxSelect(e.target.value)} inputMode="numeric" />}
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-4 w-4 rounded" /> บังคับเลือก
        </label>
        {isEdit && <button onClick={del} className="text-sm text-rose-500 hover:underline">ลบกลุ่มนี้</button>}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={save} isLoading={saving}>บันทึก</Button>
      </ModalFooter>
    </Modal>
  );
}

function OptionModal({ groupId, option, onClose, onSaved }: { groupId: string; option: PosModifierOption | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!option;
  const [name, setName] = useState(option?.name ?? '');
  const [price, setPrice] = useState(option ? String(option.price_satang / 100) : '');
  const [invId, setInvId] = useState(option?.inv_product_id ?? '');
  const [qty, setQty] = useState(option?.qty != null ? String(option.qty) : '');
  const [products, setProducts] = useState<InvProduct[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/inventory/products?active=1').then((r) => r.json()).then((d) => setProducts(d.products ?? [])).catch(() => {});
  }, []);

  const save = async () => {
    if (!name.trim()) return toast({ type: 'error', title: 'ต้องระบุชื่อตัวเลือก' });
    setSaving(true);
    try {
      const body = {
        ...(isEdit ? {} : { groupId }),
        name: name.trim(),
        priceSatang: price ? bahtToSatang(Number(price)) : 0,
        invProductId: invId || null,
        qty: invId && qty ? Number(qty) : null,
      };
      const res = await fetch(isEdit ? `/api/pos/modifier-options/${option!.id}` : '/api/pos/modifier-options', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'บันทึกไม่สำเร็จ');
      onSaved();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!isEdit || !window.confirm('ลบตัวเลือกนี้?')) return;
    await fetch(`/api/pos/modifier-options/${option!.id}`, { method: 'DELETE' });
    onSaved();
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'แก้ตัวเลือก' : 'เพิ่มตัวเลือก'} size="sm">
      <div className="space-y-3">
        <Input label="ชื่อตัวเลือก" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น เผ็ดน้อย, +ไข่ดาว" />
        <Input label="ราคาเพิ่ม (บาท)" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0" />
        <Select
          label="ตัดวัตถุดิบ (ไม่บังคับ)"
          value={invId ?? ''}
          onChange={(e) => setInvId(e.target.value)}
          placeholder="— ไม่ตัด —"
          options={products.map((p) => ({ value: p.id, label: p.name }))}
        />
        {invId && <Input label="จำนวนวัตถุดิบที่ตัด" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="เช่น 1" />}
        {isEdit && <button onClick={del} className="text-sm text-rose-500 hover:underline">ลบตัวเลือกนี้</button>}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={save} isLoading={saving}>บันทึก</Button>
      </ModalFooter>
    </Modal>
  );
}
