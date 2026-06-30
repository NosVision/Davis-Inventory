'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2, Pencil } from 'lucide-react';
import { Button, Input, Select, Modal, ModalFooter, toast } from '@/components/ui';
import { formatBaht, bahtToSatang } from '@/lib/pos/money';
import type { PosPromotion } from '@/types/pos';

export function PromotionManager({ storeId, isManager }: { storeId: string; isManager: boolean }) {
  const [promos, setPromos] = useState<PosPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<PosPromotion | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/promotions?storeId=${storeId}`);
      const d = await res.json();
      if (res.ok) setPromos(d.promotions ?? []);
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
      {isManager && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>เพิ่มโปรโมชั่น</Button>}
      {promos.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">ยังไม่มีโปรโมชั่น</p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {promos.map((p) => (
            <li key={p.id} className="flex items-center gap-3 bg-white px-4 py-2.5 dark:bg-gray-800">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white">{p.code}</span>
                  {!p.active && <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-500 dark:bg-gray-700">ปิด</span>}
                </div>
                <p className="text-xs text-gray-400">
                  {p.kind === 'percent' ? `ลด ${p.percent}%` : `ลด ฿${formatBaht(p.amount_satang ?? 0)}`}
                  {p.min_spend_satang > 0 ? ` · ขั้นต่ำ ฿${formatBaht(p.min_spend_satang)}` : ''}
                  {p.max_uses != null ? ` · ใช้ ${p.uses}/${p.max_uses}` : ` · ใช้ ${p.uses}`}
                </p>
              </div>
              {isManager && <button onClick={() => setEdit(p)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><Pencil className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {edit && <PromoModal storeId={storeId} promo={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function PromoModal({ storeId, promo, onClose, onSaved }: { storeId: string; promo: PosPromotion | 'new'; onClose: () => void; onSaved: () => void }) {
  const isEdit = promo !== 'new';
  const p = isEdit ? (promo as PosPromotion) : null;
  const [code, setCode] = useState(p?.code ?? '');
  const [name, setName] = useState(p?.name ?? '');
  const [kind, setKind] = useState<'percent' | 'amount'>(p?.kind ?? 'percent');
  const [value, setValue] = useState(p ? String(p.kind === 'percent' ? (p.percent ?? 0) : (p.amount_satang ?? 0) / 100) : '');
  const [minSpend, setMinSpend] = useState(p && p.min_spend_satang ? String(p.min_spend_satang / 100) : '');
  const [maxUses, setMaxUses] = useState(p?.max_uses != null ? String(p.max_uses) : '');
  const [active, setActive] = useState(p?.active ?? true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!code.trim()) return toast({ type: 'error', title: 'ต้องระบุโค้ด' });
    setSaving(true);
    try {
      const v = Number(value) || 0;
      const common = {
        name: name.trim() || undefined,
        percent: kind === 'percent' ? v : undefined,
        amountSatang: kind === 'amount' ? bahtToSatang(v) : undefined,
        minSpendSatang: minSpend ? bahtToSatang(Number(minSpend)) : 0,
        maxUses: maxUses ? Number(maxUses) : null,
      };
      const res = await fetch(isEdit ? `/api/pos/promotions/${p!.id}` : '/api/pos/promotions', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { ...common, active } : { storeId, code: code.trim(), kind, ...common }),
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
    if (!isEdit || !window.confirm('ลบโปรโมชั่นนี้?')) return;
    await fetch(`/api/pos/promotions/${p!.id}`, { method: 'DELETE' });
    onSaved();
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'แก้โปรโมชั่น' : 'เพิ่มโปรโมชั่น'} size="sm">
      <div className="space-y-3">
        <Input label="โค้ด *" value={code} onChange={(e) => setCode(e.target.value)} placeholder="เช่น SAVE10" disabled={isEdit} />
        <Input label="ชื่อ (ไม่บังคับ)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="ประเภท" value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'amount')} options={[{ value: 'percent', label: 'ลดเปอร์เซ็นต์' }, { value: 'amount', label: 'ลดเป็นบาท' }]} />
          <Input label={kind === 'percent' ? 'ลด (%)' : 'ลด (บาท)'} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="ยอดขั้นต่ำ (บาท)" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} inputMode="decimal" placeholder="0" />
          <Input label="จำกัดใช้ (ครั้ง)" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} inputMode="numeric" placeholder="ไม่จำกัด" />
        </div>
        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded" /> เปิดใช้งาน
          </label>
        )}
        {isEdit && <button onClick={del} className="text-sm text-rose-500 hover:underline">ลบโปรโมชั่นนี้</button>}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={save} isLoading={saving}>บันทึก</Button>
      </ModalFooter>
    </Modal>
  );
}
