'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Search, FlaskConical } from 'lucide-react';
import { Button, Input, Select, Modal, ModalFooter, toast } from '@/components/ui';
import { InvItemPicker, type ItemLine } from './inv-item-picker';
import { formatBaht } from '@/lib/pos/money';

interface StoreOpt { id: string; name: string }
interface MenuItem { id: string; name: string; price_satang: number }

export function RecipesTab({ isMgmt, stores }: { isMgmt: boolean; stores: StoreOpt[] }) {
  const [storeId, setStoreId] = useState('');
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<MenuItem | null>(null);

  useEffect(() => {
    if (!storeId && stores.length) setStoreId(stores[0].id);
  }, [stores, storeId]);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/bootstrap?storeId=${storeId}`);
      const d = await res.json();
      if (res.ok) setItems((d.items as MenuItem[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [storeId]);
  useEffect(() => {
    load();
  }, [load]);

  const ql = q.trim().toLowerCase();
  const filtered = items.filter((m) => !ql || m.name.toLowerCase().includes(ql));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-56">
          <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} options={stores.map((s) => ({ value: s.id, label: s.name }))} placeholder="เลือกสาขา" />
        </div>
        <div className="min-w-[160px] flex-1">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเมนู" leftIcon={<Search className="h-4 w-4" />} />
        </div>
      </div>
      <p className="text-xs text-gray-400">เลือกเมนูเพื่อตั้งสูตรวัตถุดิบ (ใช้ตัดสต๊อกตอนขาย) — วัตถุดิบดึงจากแคตตาล็อกกลาง</p>

      {!storeId ? (
        <p className="py-10 text-center text-sm text-gray-400">เลือกสาขา</p>
      ) : loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">สาขานี้ยังไม่มีเมนู (เพิ่มเมนูในระบบ POS ก่อน)</p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {filtered.map((m) => (
            <li key={m.id} className="flex items-center gap-3 bg-white px-4 py-2.5 dark:bg-gray-800">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-gray-900 dark:text-white">{m.name}</p>
                <p className="text-xs text-gray-400">{formatBaht(m.price_satang)} ฿</p>
              </div>
              <button onClick={() => setEditing(m)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20" title="ตั้งสูตร">
                <FlaskConical className="h-4 w-4" /> สูตร
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && <RecipeModal menuItem={editing} isMgmt={isMgmt} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RecipeModal({ menuItem, isMgmt, onClose }: { menuItem: MenuItem; isMgmt: boolean; onClose: () => void }) {
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/pos/menu-items/${menuItem.id}/recipes`)
      .then((r) => r.json())
      .then((d) => {
        const ls: ItemLine[] = (d.recipes ?? []).map(
          (r: { inv_product_id: string; qty: number; product?: { name?: string; sku?: string; unit?: string | null } | null }) => ({
            productId: r.inv_product_id,
            name: r.product?.name ?? '',
            sku: r.product?.sku ?? '',
            unit: r.product?.unit ?? null,
            qty: String(r.qty),
          }),
        );
        setLines(ls);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [menuItem.id]);

  const save = async () => {
    setSaving(true);
    try {
      const body = { lines: lines.map((l) => ({ invProductId: l.productId, qty: Number(l.qty) })).filter((l) => l.qty > 0) };
      const res = await fetch(`/api/pos/menu-items/${menuItem.id}/recipes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'บันทึกไม่สำเร็จ');
      toast({ type: 'success', title: 'บันทึกสูตรแล้ว' });
      onClose();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`สูตร · ${menuItem.name}`} size="md">
      {!loaded ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">วัตถุดิบที่ใช้ต่อ 1 หน่วยขาย (จำนวน = ต่อ 1 จาน/แก้ว/ขวด)</p>
          <InvItemPicker value={lines} onChange={setLines} />
        </div>
      )}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ปิด</Button>
        {isMgmt && <Button onClick={save} isLoading={saving}>บันทึกสูตร</Button>}
      </ModalFooter>
    </Modal>
  );
}
