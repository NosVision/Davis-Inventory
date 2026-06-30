'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Button, Select, Textarea, Modal, ModalFooter, toast } from '@/components/ui';
import { InvItemPicker, type ItemLine } from './inv-item-picker';
import type { InvReqStatus, InvRequisition, InvRequisitionItem, InvProduct } from '@/types/inventory';

interface StoreOpt { id: string; name: string }
type ReqRow = InvRequisition & {
  items?: (InvRequisitionItem & { product?: InvProduct | null })[];
  store?: { store_name?: string } | null;
};

const STATUS: Record<InvReqStatus, { label: string; cls: string }> = {
  draft: { label: 'ร่าง', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  submitted: { label: 'รออนุมัติ', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  approved: { label: 'อนุมัติแล้ว', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  fulfilled: { label: 'จ่ายของแล้ว', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  cancelled: { label: 'ยกเลิก', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-700' },
  rejected: { label: 'ปฏิเสธ', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
};
const fmtQty = (n: number) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 3 });
const Badge = ({ s }: { s: InvReqStatus }) => (
  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[s].cls}`}>{STATUS[s].label}</span>
);

export function RequisitionsTab({ isMgmt, stores }: { isMgmt: boolean; stores: StoreOpt[] }) {
  const [rows, setRows] = useState<ReqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeFilter, setStoreFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/inventory/requisitions${storeFilter !== 'all' ? `?storeId=${storeFilter}` : ''}`;
      const res = await fetch(url);
      const d = await res.json();
      if (res.ok) setRows(d.requisitions ?? []);
    } finally {
      setLoading(false);
    }
  }, [storeFilter]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-56">
          <Select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            options={[{ value: 'all', label: 'ทุกสาขา' }, ...stores.map((s) => ({ value: s.id, label: s.name }))]}
          />
        </div>
        <div className="ml-auto">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>เปิดใบเบิก</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">ยังไม่มีใบเบิก</p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {rows.map((r) => (
            <li key={r.id}>
              <button onClick={() => setDetailId(r.id)} className="flex w-full items-center gap-3 bg-white px-4 py-3 text-left hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-400">{r.req_code}</span>
                    <Badge s={r.status} />
                  </div>
                  <p className="mt-0.5 truncate text-sm font-medium text-gray-900 dark:text-white">
                    {r.store?.store_name ?? 'สาขา'} · {r.items?.length ?? 0} รายการ
                  </p>
                </div>
                <span className="shrink-0 text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showCreate && <CreateReqModal stores={stores} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {detailId && <ReqDetailModal id={detailId} isMgmt={isMgmt} onClose={() => setDetailId(null)} onChanged={load} />}
    </div>
  );
}

function CreateReqModal({ stores, onClose, onCreated }: { stores: StoreOpt[]; onClose: () => void; onCreated: () => void }) {
  const [storeId, setStoreId] = useState(stores.length === 1 ? stores[0].id : '');
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!storeId) return toast({ type: 'error', title: 'เลือกสาขาที่เบิก' });
    const items = lines.map((l) => ({ productId: l.productId, requestedQty: Number(l.qty) })).filter((i) => i.requestedQty > 0);
    if (items.length === 0) return toast({ type: 'error', title: 'เพิ่มรายการอย่างน้อย 1 รายการ' });
    setSaving(true);
    try {
      const res = await fetch('/api/inventory/requisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, items, note }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'เปิดใบเบิกไม่สำเร็จ');
      toast({ type: 'success', title: 'เปิดใบเบิกแล้ว', message: d.requisition?.req_code });
      onCreated();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="เปิดใบเบิก (สาขา → HQ)" size="lg">
      <div className="space-y-4">
        <Select label="สาขาที่เบิก" value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder="— เลือกสาขา —" options={stores.map((s) => ({ value: s.id, label: s.name }))} />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">รายการที่ขอเบิก</label>
          <InvItemPicker value={lines} onChange={setLines} />
        </div>
        <Textarea label="หมายเหตุ" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={submit} isLoading={saving}>ส่งใบเบิก</Button>
      </ModalFooter>
    </Modal>
  );
}

function ReqDetailModal({ id, isMgmt, onClose, onChanged }: { id: string; isMgmt: boolean; onClose: () => void; onChanged: () => void }) {
  const [req, setReq] = useState<ReqRow | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/inventory/requisitions/${id}`);
    const d = await res.json();
    if (res.ok) setReq(d.requisition);
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/inventory/requisitions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'ทำรายการไม่สำเร็จ');
      toast({ type: 'success', title: 'สำเร็จ' });
      setReq(d.requisition);
      onChanged();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={req?.req_code ?? 'ใบเบิก'} size="lg">
      {!req ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Badge s={req.status} />
            <span className="text-gray-500">{req.store?.store_name}</span>
          </div>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
            {(req.items ?? []).map((it) => (
              <li key={it.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-gray-900 dark:text-white">{it.product?.name ?? 'สินค้า'}</p>
                  <p className="font-mono text-[10px] text-gray-400">{it.product?.sku}</p>
                </div>
                <span className="text-right text-xs text-gray-500">
                  ขอ <b>{fmtQty(it.requested_qty)}</b>
                  {it.approved_qty != null ? ` · อนุมัติ ${fmtQty(it.approved_qty)}` : ''}
                  {Number(it.fulfilled_qty) > 0 ? ` · จ่าย ${fmtQty(it.fulfilled_qty)}` : ''} {it.product?.unit ?? ''}
                </span>
              </li>
            ))}
          </ul>
          {req.note && <p className="rounded-lg bg-gray-50 p-2 text-xs text-gray-500 dark:bg-gray-800">{req.note}</p>}

          {isMgmt && req.status === 'submitted' && (
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="เหตุผล (กรณีปฏิเสธ)" />
          )}
        </div>
      )}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ปิด</Button>
        {req && (req.status === 'submitted' || req.status === 'approved') && (
          <Button variant="outline" onClick={() => act('cancel')} disabled={busy}>ยกเลิกใบ</Button>
        )}
        {req && isMgmt && req.status === 'submitted' && (
          <>
            <Button variant="danger" onClick={() => act('reject', { reason })} disabled={busy}>ปฏิเสธ</Button>
            <Button onClick={() => act('approve')} isLoading={busy}>อนุมัติ</Button>
          </>
        )}
        {req && isMgmt && req.status === 'approved' && (
          <Button onClick={() => act('fulfill')} isLoading={busy}>จ่ายของ (ตัดสต๊อก)</Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
