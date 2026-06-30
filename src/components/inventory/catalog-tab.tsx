'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Loader2, Pencil } from 'lucide-react';
import { Button, Input, Select, Modal, ModalFooter, toast } from '@/components/ui';
import type { InvKind, InvProduct } from '@/types/inventory';

const KIND_LABELS: Record<InvKind, string> = { drink: 'เครื่องดื่ม', food: 'วัตถุดิบอาหาร', other: 'อื่น ๆ' };
const KIND_OPTIONS = [
  { value: 'drink', label: 'เครื่องดื่ม' },
  { value: 'food', label: 'วัตถุดิบอาหาร' },
  { value: 'other', label: 'อื่น ๆ' },
];

export function CatalogTab({ isMgmt }: { isMgmt: boolean }) {
  const [products, setProducts] = useState<InvProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<InvProduct | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/inventory/products${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`;
      const res = await fetch(url);
      const d = await res.json();
      if (res.ok) setProducts(d.products ?? []);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อ / SKU" leftIcon={<Search className="h-4 w-4" />} />
        </div>
        {isMgmt && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>เพิ่มสินค้า</Button>}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
      ) : products.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">ยังไม่มีสินค้าในแคตตาล็อก</p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {products.map((p) => (
            <li key={p.id} className="flex items-center gap-3 bg-white px-4 py-2.5 dark:bg-gray-800">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-gray-900 dark:text-white">{p.name}</span>
                  {!p.active && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700">ปิดใช้</span>}
                </div>
                <p className="text-xs text-gray-400">
                  <span className="font-mono">{p.sku}</span> · {KIND_LABELS[p.kind]}
                  {p.category ? ` · ${p.category}` : ''}
                  {p.unit ? ` · หน่วย ${p.unit}` : ''}
                </p>
              </div>
              {isMgmt && (
                <button onClick={() => setEditing(p)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" title="แก้ไข">
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ProductModal
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ProductModal({ product, onClose, onSaved }: { product: InvProduct | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!product;
  const [sku, setSku] = useState(product?.sku ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [unit, setUnit] = useState(product?.unit ?? '');
  const [kind, setKind] = useState<InvKind>(product?.kind ?? 'drink');
  const [active, setActive] = useState(product?.active ?? true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!isEdit && !sku.trim()) return toast({ type: 'error', title: 'ต้องระบุรหัส SKU' });
    if (!name.trim()) return toast({ type: 'error', title: 'ต้องระบุชื่อสินค้า' });
    setSaving(true);
    try {
      const res = await fetch(isEdit ? `/api/inventory/products/${product!.id}` : '/api/inventory/products', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEdit
            ? { name: name.trim(), category, unit, kind, active }
            : { sku: sku.trim(), name: name.trim(), category, unit, kind },
        ),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'บันทึกไม่สำเร็จ');
      toast({ type: 'success', title: isEdit ? 'บันทึกแล้ว' : 'เพิ่มสินค้าแล้ว' });
      onSaved();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใน master'} size="md">
      <div className="space-y-3">
        <Input label="รหัส SKU *" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="เช่น BEER-SINGHA-330" disabled={isEdit} />
        <Input label="ชื่อสินค้า *" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น เบียร์สิงห์ 330ml" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="ประเภท" value={kind} onChange={(e) => setKind(e.target.value as InvKind)} options={KIND_OPTIONS} />
          <Input label="หน่วย" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ขวด / กก. / ลัง" />
        </div>
        <Input label="หมวด (ไม่บังคับ)" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="เช่น เบียร์, สุรา, เนื้อสัตว์" />
        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded" />
            เปิดใช้งาน
          </label>
        )}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={submit} isLoading={saving}>{isEdit ? 'บันทึก' : 'เพิ่มสินค้า'}</Button>
      </ModalFooter>
    </Modal>
  );
}
