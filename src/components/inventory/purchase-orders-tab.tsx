'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Button, Select, Textarea, Modal, ModalFooter, toast } from '@/components/ui';
import { InvItemPicker, type ItemLine } from './inv-item-picker';
import { bahtToSatang, formatBaht } from '@/lib/pos/money';
import type { InvPoStatus, InvPurchaseOrder, InvPurchaseOrderItem, InvProduct, InvSupplier } from '@/types/inventory';

type PoRow = InvPurchaseOrder & {
  items?: (InvPurchaseOrderItem & { product?: InvProduct | null })[];
  supplier?: { name?: string } | null;
};

const STATUS: Record<InvPoStatus, { label: string; cls: string }> = {
  draft: { label: 'ร่าง', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  submitted: { label: 'รอรับของ', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  partial: { label: 'รับบางส่วน', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  received: { label: 'รับครบแล้ว', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  cancelled: { label: 'ยกเลิก', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-700' },
};
const fmtQty = (n: number) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 3 });
const Badge = ({ s }: { s: InvPoStatus }) => (
  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[s].cls}`}>{STATUS[s].label}</span>
);

export function PurchaseOrdersTab({ isMgmt }: { isMgmt: boolean }) {
  const [rows, setRows] = useState<PoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/inventory/purchase-orders');
      const d = await res.json();
      if (res.ok) setRows(d.purchaseOrders ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!isMgmt) {
    return <p className="py-10 text-center text-sm text-gray-400">ใบสั่งซื้อจัดการโดยฝ่าย HQ/จัดการเท่านั้น</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>เปิดใบสั่งซื้อ</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">ยังไม่มีใบสั่งซื้อ</p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {rows.map((r) => (
            <li key={r.id}>
              <button onClick={() => setDetailId(r.id)} className="flex w-full items-center gap-3 bg-white px-4 py-3 text-left hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-400">{r.po_code}</span>
                    <Badge s={r.status} />
                  </div>
                  <p className="mt-0.5 truncate text-sm font-medium text-gray-900 dark:text-white">
                    {r.supplier?.name ?? 'ไม่ระบุซัพ'} · {r.items?.length ?? 0} รายการ
                  </p>
                </div>
                <span className="shrink-0 text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showCreate && <CreatePoModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {detailId && <PoDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
    </div>
  );
}

function CreatePoModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [suppliers, setSuppliers] = useState<InvSupplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/inventory/suppliers?active=1').then((r) => r.json()).then((d) => setSuppliers(d.suppliers ?? [])).catch(() => {});
  }, []);

  const submit = async () => {
    const items = lines
      .map((l) => ({
        productId: l.productId,
        qtyOrdered: Number(l.qty),
        unitCostSatang: l.cost && Number(l.cost) > 0 ? bahtToSatang(Number(l.cost)) : undefined,
      }))
      .filter((i) => i.qtyOrdered > 0);
    if (items.length === 0) return toast({ type: 'error', title: 'เพิ่มรายการอย่างน้อย 1 รายการ' });
    setSaving(true);
    try {
      const res = await fetch('/api/inventory/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierId: supplierId || undefined, items, note }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'เปิดใบสั่งซื้อไม่สำเร็จ');
      toast({ type: 'success', title: 'เปิดใบสั่งซื้อแล้ว', message: d.purchaseOrder?.po_code });
      onCreated();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="เปิดใบสั่งซื้อ (HQ → ซัพพลายเออร์)" size="lg">
      <div className="space-y-4">
        <Select
          label="ซัพพลายเออร์"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          placeholder="— ไม่ระบุ —"
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">รายการสั่งซื้อ (ทุน/หน่วย = บาท)</label>
          <InvItemPicker value={lines} onChange={setLines} showCost />
        </div>
        <Textarea label="หมายเหตุ" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={submit} isLoading={saving}>เปิดใบสั่งซื้อ</Button>
      </ModalFooter>
    </Modal>
  );
}

function PoDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [po, setPo] = useState<PoRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/inventory/purchase-orders/${id}`);
    const d = await res.json();
    if (res.ok) setPo(d.purchaseOrder);
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/inventory/purchase-orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'ทำรายการไม่สำเร็จ');
      toast({ type: 'success', title: action === 'receive' ? 'รับของเข้าคลัง HQ แล้ว' : 'สำเร็จ' });
      setPo(d.purchaseOrder);
      onChanged();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const canReceive = po && (po.status === 'submitted' || po.status === 'partial');

  return (
    <Modal isOpen onClose={onClose} title={po?.po_code ?? 'ใบสั่งซื้อ'} size="lg">
      {!po ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Badge s={po.status} />
            <span className="text-gray-500">{po.supplier?.name ?? 'ไม่ระบุซัพ'}</span>
          </div>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
            {(po.items ?? []).map((it) => (
              <li key={it.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-gray-900 dark:text-white">{it.product?.name ?? 'สินค้า'}</p>
                  <p className="font-mono text-[10px] text-gray-400">
                    {it.product?.sku}
                    {it.unit_cost_satang != null ? ` · ทุน ${formatBaht(it.unit_cost_satang)}` : ''}
                  </p>
                </div>
                <span className="text-right text-xs text-gray-500">
                  สั่ง <b>{fmtQty(it.qty_ordered)}</b>
                  {Number(it.qty_received) > 0 ? ` · รับแล้ว ${fmtQty(it.qty_received)}` : ''} {it.product?.unit ?? ''}
                </span>
              </li>
            ))}
          </ul>
          {po.note && <p className="rounded-lg bg-gray-50 p-2 text-xs text-gray-500 dark:bg-gray-800">{po.note}</p>}
        </div>
      )}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ปิด</Button>
        {po && (po.status === 'submitted' || po.status === 'partial') && (
          <Button variant="outline" onClick={() => act('cancel')} disabled={busy}>ยกเลิก</Button>
        )}
        {canReceive && <Button onClick={() => act('receive')} isLoading={busy}>รับของเข้าคลัง HQ</Button>}
      </ModalFooter>
    </Modal>
  );
}
