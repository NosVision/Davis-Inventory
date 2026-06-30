'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Search, SlidersHorizontal } from 'lucide-react';
import { Button, Input, Select, Modal, ModalFooter, toast } from '@/components/ui';
import type { InvKind, InvProduct, InvStoreProductRow } from '@/types/inventory';

const KIND_LABELS: Record<InvKind, string> = { drink: 'เครื่องดื่ม', food: 'วัตถุดิบอาหาร', other: 'อื่น ๆ' };
const REASON_OPTIONS = [
  { value: 'opening', label: 'ตั้งต้น (ยอดยกมา)' },
  { value: 'count_adjust', label: 'ปรับยอด (จากการนับ)' },
  { value: 'waste', label: 'ของเสีย' },
];

const fmtQty = (n: number) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 3 });

interface StoreOpt {
  id: string;
  name: string;
}

export function StockTab({ isMgmt, stores }: { isMgmt: boolean; stores: StoreOpt[] }) {
  const [storeId, setStoreId] = useState('');
  const [rows, setRows] = useState<InvStoreProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [adjust, setAdjust] = useState<InvStoreProductRow | null>(null);

  useEffect(() => {
    if (!storeId && stores.length) setStoreId(stores[0].id);
  }, [stores, storeId]);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/store-products?storeId=${storeId}`);
      const d = await res.json();
      if (res.ok) setRows(d.storeProducts ?? []);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64">
          <Select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            options={stores.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="เลือกสาขา"
          />
        </div>
        {isMgmt && storeId && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowLink(true)}>เพิ่มสินค้าเข้าสาขา</Button>
        )}
      </div>

      {!storeId ? (
        <p className="py-10 text-center text-sm text-gray-400">เลือกสาขาเพื่อดูสต๊อก</p>
      ) : loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">สาขานี้ยังไม่มีสินค้า — กด “เพิ่มสินค้าเข้าสาขา”</p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {rows.map((r) => {
            const name = r.store_name || r.product?.name || 'สินค้า';
            const sku = r.store_sku || r.product?.sku || '';
            const bal = r.balance ?? 0;
            return (
              <li key={r.id} className="flex items-center gap-3 bg-white px-4 py-2.5 dark:bg-gray-800">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900 dark:text-white">{name}</p>
                  <p className="text-xs text-gray-400">
                    <span className="font-mono">{sku}</span>
                    {r.product ? ` · ${KIND_LABELS[r.product.kind]}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`font-mono text-sm font-semibold ${bal < 0 ? 'text-rose-600' : 'text-gray-900 dark:text-white'}`}>
                    {fmtQty(bal)}
                  </span>
                  <span className="ml-1 text-xs text-gray-400">{r.product?.unit ?? ''}</span>
                </div>
                <button
                  onClick={() => setAdjust(r)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                  title="ปรับสต๊อก"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {showLink && (
        <LinkModal
          storeId={storeId}
          linkedIds={rows.map((r) => r.product_id)}
          onClose={() => setShowLink(false)}
          onSaved={() => { setShowLink(false); load(); }}
        />
      )}
      {adjust && (
        <AdjustModal storeId={storeId} row={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); load(); }} />
      )}
    </div>
  );
}

// ── ผูกสินค้า master เข้าสาขา (หลายชิ้นทีเดียว) ──
function LinkModal({ storeId, linkedIds, onClose, onSaved }: { storeId: string; linkedIds: string[]; onClose: () => void; onSaved: () => void }) {
  const [all, setAll] = useState<InvProduct[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const linked = useMemo(() => new Set(linkedIds), [linkedIds]);

  useEffect(() => {
    fetch('/api/inventory/products?active=1')
      .then((r) => r.json())
      .then((d) => setAll(d.products ?? []))
      .catch(() => {});
  }, []);

  const ql = q.trim().toLowerCase();
  const available = all.filter(
    (p) => !linked.has(p.id) && (!ql || `${p.name} ${p.sku}`.toLowerCase().includes(ql)),
  );

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async () => {
    if (sel.length === 0) return toast({ type: 'error', title: 'เลือกสินค้าก่อน' });
    setSaving(true);
    try {
      const res = await fetch('/api/inventory/store-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, productIds: sel }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'ผูกไม่สำเร็จ');
      toast({ type: 'success', title: `เพิ่มเข้าสาขาแล้ว ${sel.length} รายการ` });
      onSaved();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="เพิ่มสินค้าเข้าสาขา" size="md">
      <div className="space-y-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาในแคตตาล็อก" leftIcon={<Search className="h-4 w-4" />} />
        <p className="px-0.5 text-xs text-gray-400">เลือกแล้ว {sel.length} · เหลือให้เลือก {available.length}</p>
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-1.5 dark:border-gray-700">
          {available.length === 0 ? (
            <p className="p-2 text-xs text-gray-400">ไม่มีสินค้าให้เพิ่ม (อาจผูกครบแล้ว)</p>
          ) : (
            available.map((p) => {
              const on = sel.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${on ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${on ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}>
                    {on ? '✓' : ''}
                  </span>
                  <span className="flex-1 truncate text-gray-700 dark:text-gray-200">{p.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-gray-400">{p.sku}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={submit} isLoading={saving}>เพิ่ม {sel.length || ''}</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── ปรับสต๊อกมือ (ตั้งต้น/นับ/ของเสีย) ──
function AdjustModal({ storeId, row, onClose, onSaved }: { storeId: string; row: InvStoreProductRow; onClose: () => void; onSaved: () => void }) {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('count_adjust');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const name = row.store_name || row.product?.name || 'สินค้า';

  const submit = async () => {
    const n = Number(qty);
    if (!qty.trim() || !Number.isFinite(n) || n === 0) {
      return toast({ type: 'error', title: 'ใส่จำนวน + เข้า / − ออก (ไม่ใช่ศูนย์)' });
    }
    setSaving(true);
    try {
      const res = await fetch('/api/inventory/movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, productId: row.product_id, qty: n, reason, note }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'ปรับไม่สำเร็จ');
      toast({ type: 'success', title: 'ปรับสต๊อกแล้ว', message: `คงเหลือ ${fmtQty(d.balance)}` });
      onSaved();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`ปรับสต๊อก · ${name}`} size="sm">
      <div className="space-y-3">
        <p className="rounded-lg bg-gray-50 p-2.5 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          คงเหลือปัจจุบัน <b className="font-mono">{fmtQty(row.balance ?? 0)}</b> {row.product?.unit ?? ''}
        </p>
        <Input
          label="จำนวน (+ เข้า / − ออก)"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="เช่น 100 หรือ -5"
          inputMode="decimal"
        />
        <Select label="เหตุผล" value={reason} onChange={(e) => setReason(e.target.value)} options={REASON_OPTIONS} />
        <Input label="หมายเหตุ (ไม่บังคับ)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={submit} isLoading={saving}>บันทึก</Button>
      </ModalFooter>
    </Modal>
  );
}
