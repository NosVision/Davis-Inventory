'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2, Pencil, ChefHat, Wine } from 'lucide-react';
import { Button, Input, Select, Modal, ModalFooter, toast } from '@/components/ui';
import { InvItemPicker, type ItemLine } from '@/components/inventory/inv-item-picker';
import { formatBaht, bahtToSatang } from '@/lib/pos/money';
import type { MenuCategory, MenuItem } from '@/types/pos';

const STATION_OPTIONS = [
  { value: '', label: '— ไม่ระบุ —' },
  { value: 'kitchen', label: 'ครัว' },
  { value: 'bar', label: 'บาร์' },
];
const stationBadge = (s: string | null) =>
  s === 'kitchen' ? (
    <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-600"><ChefHat className="h-3 w-3" /> ครัว</span>
  ) : s === 'bar' ? (
    <span className="inline-flex items-center gap-0.5 text-[11px] text-sky-600"><Wine className="h-3 w-3" /> บาร์</span>
  ) : null;

export function MenuManager({ storeId, isManager }: { storeId: string; isManager: boolean }) {
  const [cats, setCats] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState<MenuItem | 'new' | null>(null);
  const [editCat, setEditCat] = useState<MenuCategory | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cr, ir] = await Promise.all([
        fetch(`/api/pos/menu-categories?storeId=${storeId}`).then((r) => r.json()),
        fetch(`/api/pos/menu-items?storeId=${storeId}`).then((r) => r.json()),
      ]);
      setCats(cr.categories ?? []);
      setItems(ir.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [storeId]);
  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>;

  const groups = [
    ...cats.map((c) => ({ cat: c, items: items.filter((i) => i.category_id === c.id) })),
    { cat: null, items: items.filter((i) => !i.category_id) },
  ].filter((g) => g.cat || g.items.length > 0);

  return (
    <div className="space-y-3">
      {isManager && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditItem('new')}>เพิ่มเมนู</Button>
          <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setEditCat('new')}>เพิ่มหมวด</Button>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">ยังไม่มีเมนู</p>
      ) : (
        groups.map(({ cat, items: list }) => (
          <div key={cat?.id ?? 'none'} className="rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{cat?.name ?? 'ไม่มีหมวด'}</span>
                {cat && stationBadge(cat.station)}
                {cat && !cat.active && <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-500 dark:bg-gray-700">ปิด</span>}
              </div>
              {isManager && cat && (
                <button onClick={() => setEditCat(cat)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><Pencil className="h-4 w-4" /></button>
              )}
            </div>
            {list.length === 0 ? (
              <p className="px-4 py-3 text-xs text-gray-400">ยังไม่มีเมนูในหมวดนี้</p>
            ) : (
              <ul className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {list.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm text-gray-900 dark:text-white">{m.name}</span>
                      {!m.active && <span className="ml-2 rounded bg-gray-100 px-1.5 text-[10px] text-gray-500 dark:bg-gray-700">ปิดขาย</span>}
                    </div>
                    <span className="font-mono text-sm text-indigo-600 dark:text-indigo-400">฿{formatBaht(m.price_satang)}</span>
                    {isManager && (
                      <button onClick={() => setEditItem(m)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><Pencil className="h-4 w-4" /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}

      {editItem && (
        <ItemModal storeId={storeId} item={editItem} categories={cats} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); load(); }} />
      )}
      {editCat && (
        <CategoryModal storeId={storeId} category={editCat} onClose={() => setEditCat(null)} onSaved={() => { setEditCat(null); load(); }} />
      )}
    </div>
  );
}

function CategoryModal({ storeId, category, onClose, onSaved }: { storeId: string; category: MenuCategory | 'new'; onClose: () => void; onSaved: () => void }) {
  const isEdit = category !== 'new';
  const cat = isEdit ? (category as MenuCategory) : null;
  const [name, setName] = useState(cat?.name ?? '');
  const [station, setStation] = useState(cat?.station ?? '');
  const [active, setActive] = useState(cat?.active ?? true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast({ type: 'error', title: 'ต้องระบุชื่อหมวด' });
    setSaving(true);
    try {
      const res = await fetch(isEdit ? `/api/pos/menu-categories/${cat!.id}` : '/api/pos/menu-categories', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { name: name.trim(), station, active } : { storeId, name: name.trim(), station }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'บันทึกไม่สำเร็จ');
      onSaved();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!isEdit || !window.confirm('ลบหมวดนี้? (เมนูในหมวดจะหลุดออกจากหมวด ไม่ถูกลบ)')) return;
    await fetch(`/api/pos/menu-categories/${cat!.id}`, { method: 'DELETE' });
    onSaved();
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'แก้หมวด' : 'เพิ่มหมวด'} size="sm">
      <div className="space-y-3">
        <Input label="ชื่อหมวด" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น อาหาร, เครื่องดื่ม" />
        <Select label="สเตชัน (ส่งครัว/บาร์)" value={station ?? ''} onChange={(e) => setStation(e.target.value)} options={STATION_OPTIONS} />
        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded" /> เปิดใช้งาน
          </label>
        )}
        {isEdit && (
          <button onClick={del} className="text-sm text-rose-500 hover:underline">ลบหมวดนี้</button>
        )}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={save} isLoading={saving}>บันทึก</Button>
      </ModalFooter>
    </Modal>
  );
}

function ItemModal({ storeId, item, categories, onClose, onSaved }: { storeId: string; item: MenuItem | 'new'; categories: MenuCategory[]; onClose: () => void; onSaved: () => void }) {
  const isEdit = item !== 'new';
  const mi = isEdit ? (item as MenuItem) : null;
  const [name, setName] = useState(mi?.name ?? '');
  const [price, setPrice] = useState(mi ? String(mi.price_satang / 100) : '');
  const [categoryId, setCategoryId] = useState(mi?.category_id ?? '');
  const [active, setActive] = useState(mi?.active ?? true);
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [recipeLoaded, setRecipeLoaded] = useState(!isEdit);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mi) {
      fetch(`/api/pos/menu-items/${mi.id}/recipes`)
        .then((r) => r.json())
        .then((d) => {
          setLines(
            (d.recipes ?? []).map((r: { inv_product_id: string; qty: number; product?: { name?: string; sku?: string; unit?: string | null } | null }) => ({
              productId: r.inv_product_id,
              name: r.product?.name ?? '',
              sku: r.product?.sku ?? '',
              unit: r.product?.unit ?? null,
              qty: String(r.qty),
            })),
          );
          setRecipeLoaded(true);
        })
        .catch(() => setRecipeLoaded(true));
    }
  }, [mi]);

  const save = async () => {
    if (!name.trim()) return toast({ type: 'error', title: 'ต้องระบุชื่อเมนู' });
    setSaving(true);
    try {
      const priceSatang = price ? bahtToSatang(Number(price)) : 0;
      let itemId = mi?.id ?? '';
      if (mi) {
        const res = await fetch(`/api/pos/menu-items/${mi.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), priceSatang, categoryId: categoryId || null, active }),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'บันทึกไม่สำเร็จ');
      } else {
        const res = await fetch('/api/pos/menu-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storeId, name: name.trim(), priceSatang, categoryId: categoryId || null }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'สร้างไม่สำเร็จ');
        itemId = d.item.id;
      }
      // สูตร (วัตถุดิบ)
      await fetch(`/api/pos/menu-items/${itemId}/recipes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: lines.map((l) => ({ invProductId: l.productId, qty: Number(l.qty) })).filter((l) => l.qty > 0) }),
      });
      toast({ type: 'success', title: isEdit ? 'บันทึกแล้ว' : 'เพิ่มเมนูแล้ว' });
      onSaved();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!mi || !window.confirm(`ลบเมนู ${mi.name}?`)) return;
    await fetch(`/api/pos/menu-items/${mi.id}`, { method: 'DELETE' });
    onSaved();
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'แก้เมนู' : 'เพิ่มเมนู'} size="md">
      <div className="space-y-3">
        <Input label="ชื่อเมนู *" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น กะเพราหมูไข่ดาว" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="ราคา (บาท)" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0" />
          <Select
            label="หมวด"
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value)}
            placeholder="— ไม่มีหมวด —"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded" /> เปิดขาย
          </label>
        )}

        <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
          <p className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">สูตร / วัตถุดิบ (ตัดสต๊อกตอนขาย)</p>
          {!recipeLoaded ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-emerald-500" /></div>
          ) : (
            <InvItemPicker value={lines} onChange={setLines} />
          )}
        </div>

        {isEdit && <button onClick={del} className="text-sm text-rose-500 hover:underline">ลบเมนูนี้</button>}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={save} isLoading={saving}>บันทึก</Button>
      </ModalFooter>
    </Modal>
  );
}
