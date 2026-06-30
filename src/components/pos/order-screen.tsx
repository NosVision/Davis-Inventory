'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Search, Plus, Minus, Trash2, Move, Percent, Wallet, Ticket, ChefHat } from 'lucide-react';
import { Button, Input, Select, Modal, ModalFooter, toast } from '@/components/ui';
import { formatBaht, bahtToSatang } from '@/lib/pos/money';
import { CheckoutModal } from './checkout-modal';
import { ModifierDialog } from './modifier-dialog';
import { useRealtime } from '@/hooks/use-realtime';
import { createClient } from '@/lib/supabase/client';
import { broadcastToChannel } from '@/lib/supabase/broadcast';
import type { MenuAvailability, MenuCategory, MenuItem, PosOrder, PosOrderItem, PosTable } from '@/types/pos';

interface AeOption { id: string; name: string; nickname?: string | null }

interface Props {
  orderId: string;
  storeId: string;
  categories: MenuCategory[];
  items: MenuItem[];
  modifierMenuIds?: string[];
  onBack: () => void;
}

export function OrderScreen({ orderId, storeId, categories, items, modifierMenuIds, onBack }: Props) {
  const [order, setOrder] = useState<PosOrder | null>(null);
  const [cart, setCart] = useState<PosOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeCat, setActiveCat] = useState('all');
  const [q, setQ] = useState('');
  const [aes, setAes] = useState<AeOption[]>([]);
  const [modal, setModal] = useState<'checkout' | 'move' | 'discount' | 'promo' | null>(null);
  const [avail, setAvail] = useState<Map<string, { sellable: boolean; remaining: number | null }>>(new Map());
  const [modMenu, setModMenu] = useState<MenuItem | null>(null);
  const modSet = useMemo(() => new Set(modifierMenuIds ?? []), [modifierMenuIds]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/pos/orders/${orderId}`);
    const d = await res.json();
    if (res.ok) {
      setOrder(d.order);
      setCart(d.items ?? []);
    }
    setLoading(false);
  }, [orderId]);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch(`/api/ae?store_id=${storeId}`)
      .then((r) => r.json())
      .then((d) => setAes(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [storeId]);

  // ความพร้อมขาย (เหลือ/หมด จากโควตาวัน + สต๊อก)
  const fetchAvail = useCallback(async () => {
    const res = await fetch(`/api/pos/menu-availability?storeId=${storeId}`);
    const d = await res.json();
    if (!res.ok) return;
    const m = new Map<string, { sellable: boolean; remaining: number | null }>();
    for (const a of (d.availability ?? []) as MenuAvailability[]) {
      const dailyRem = a.daily_limit != null ? Math.max(0, a.daily_limit - Number(a.sold_today)) : null;
      const stockRem = a.stock_makeable != null ? Number(a.stock_makeable) : null;
      const finite = [dailyRem, stockRem].filter((x): x is number => x != null);
      const remaining = finite.length ? Math.min(...finite) : null;
      const sellable = a.available && (dailyRem == null || dailyRem > 0) && (stockRem == null || stockRem > 0);
      m.set(a.menu_item_id, { sellable, remaining });
    }
    setAvail(m);
  }, [storeId]);
  useEffect(() => {
    fetchAvail();
  }, [fetchAvail]);

  // realtime (Postgres Changes) — ขายที่เครื่องอื่น/สต๊อกขยับ/86 → อัปเดตความพร้อมสด
  useRealtime({ table: 'pos_order_items', onInsert: fetchAvail, onUpdate: fetchAvail, onDelete: fetchAvail });
  useRealtime({ table: 'inv_stock_movements', filter: `store_id=eq.${storeId}`, onInsert: fetchAvail });
  useRealtime({ table: 'menu_items', filter: `store_id=eq.${storeId}`, onUpdate: fetchAvail });

  const refreshOrder = useCallback(async () => {
    const res = await fetch(`/api/pos/orders/${orderId}`);
    const d = await res.json();
    if (res.ok) setOrder(d.order);
  }, [orderId]);

  const addItem = async (menuItemId: string, optionIds: string[] = []) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/pos/orders/${orderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menuItemId, optionIds }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'เพิ่มไม่สำเร็จ');
      setCart(d.items ?? []);
      await refreshOrder();
      fetchAvail();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  };

  // แตะเมนู: ถ้ามีตัวเลือก → เปิด dialog, ไม่งั้นเพิ่มเลย
  const tapMenu = (m: MenuItem) => {
    if (modSet.has(m.id)) setModMenu(m);
    else addItem(m.id);
  };

  // ส่งครัว/บาร์ (KOT) + broadcast ให้ KDS เด้ง
  const [sending, setSending] = useState(false);
  const sendKitchen = async () => {
    setSending(true);
    try {
      const res = await fetch(`/api/pos/orders/${orderId}/send`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'ส่งครัวไม่สำเร็จ');
      toast({ type: 'success', title: d.sent > 0 ? `ส่งครัวแล้ว ${d.sent} รายการ` : 'ส่งครัวครบแล้ว' });
      if (d.sent > 0) {
        try {
          await broadcastToChannel(createClient(), `pos:kds:${storeId}`, 'kds_update', {});
        } catch {
          // ignore
        }
      }
      await load();
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setSending(false);
    }
  };

  const setQty = async (itemId: string, qty: number) => {
    const res = await fetch(`/api/pos/orders/${orderId}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty }),
    });
    const d = await res.json();
    if (res.ok) {
      setCart(d.items ?? []);
      await refreshOrder();
    }
  };

  const patchOrder = async (patch: Record<string, unknown>) => {
    const res = await fetch(`/api/pos/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const d = await res.json();
    if (res.ok) setOrder(d.order);
    else toast({ type: 'error', title: 'ผิดพลาด', message: d.error });
  };

  const filteredMenu = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return items.filter(
      (m) => (activeCat === 'all' || m.category_id === activeCat) && m.active && (!ql || m.name.toLowerCase().includes(ql)),
    );
  }, [items, activeCat, q]);

  if (loading || !order) {
    return <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-indigo-500" /></div>;
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
        <ArrowLeft className="h-4 w-4" /> กลับผังโต๊ะ
      </button>

      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        {/* ── เมนู ── */}
        <div className="space-y-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเมนู" leftIcon={<Search className="h-4 w-4" />} />
          <div className="flex flex-wrap gap-1.5">
            {[{ id: 'all', name: 'ทั้งหมด' }, ...categories].map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCat(c.id)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                  activeCat === c.id ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                {(c as { name: string }).name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {filteredMenu.map((m) => {
              const av = avail.get(m.id);
              const sellable = av ? av.sellable : true;
              return (
                <button
                  key={m.id}
                  disabled={busy || !sellable}
                  onClick={() => tapMenu(m)}
                  className={`flex flex-col items-start justify-between rounded-xl border bg-white p-3 text-left transition disabled:cursor-not-allowed dark:bg-gray-800 ${sellable ? 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-gray-700' : 'border-gray-200 opacity-50 dark:border-gray-700'}`}
                >
                  <span className="line-clamp-2 text-sm font-medium text-gray-900 dark:text-white">{m.name}</span>
                  <div className="mt-1 flex w-full items-center justify-between">
                    <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400">฿{formatBaht(m.price_satang)}</span>
                    {!sellable ? (
                      <span className="rounded bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">หมด</span>
                    ) : av?.remaining != null ? (
                      <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">เหลือ {av.remaining}</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
            {filteredMenu.length === 0 && <p className="col-span-full py-8 text-center text-sm text-gray-400">ไม่มีเมนู</p>}
          </div>
        </div>

        {/* ── บิล/ตะกร้า ── */}
        <div className="flex h-fit flex-col rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 lg:sticky lg:top-4">
          <div className="border-b border-gray-100 p-3 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-900 dark:text-white">
                {order.table_id ? 'โต๊ะ' : 'ขายเร็ว'} · บิล #{order.order_no}
              </span>
            </div>
            <div className="mt-2">
              <Select
                value={order.ae_id ?? ''}
                onChange={(e) => patchOrder({ aeId: e.target.value || null })}
                options={[{ value: '', label: '— ไม่ระบุ AE —' }, ...aes.map((a) => ({ value: a.id, label: a.nickname ? `${a.name} (${a.nickname})` : a.name }))]}
              />
            </div>
          </div>

          <div className="max-h-[42vh] flex-1 overflow-y-auto p-2">
            {cart.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400">ยังไม่มีรายการ — แตะเมนูเพื่อเพิ่ม</p>
            ) : (
              cart.map((it) => (
                <div key={it.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-gray-900 dark:text-white">
                      {it.name}
                      {it.sent_at && <span className="ml-1 text-[10px] font-normal text-emerald-500">• ส่งแล้ว</span>}
                    </p>
                    {it.modifiers && it.modifiers.length > 0 && (
                      <p className="truncate text-[10px] text-gray-400">{it.modifiers.map((x) => x.name).join(', ')}</p>
                    )}
                    <p className="font-mono text-[11px] text-gray-400">฿{formatBaht(it.line_total_satang)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setQty(it.id, Number(it.qty) - 1)} className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-gray-100 dark:border-gray-600">
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-6 text-center text-sm font-medium">{Number(it.qty)}</span>
                    <button onClick={() => setQty(it.id, Number(it.qty) + 1)} disabled={busy} className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600">
                      <Plus className="h-3 w-3" />
                    </button>
                    <button onClick={() => setQty(it.id, 0)} className="ml-1 text-gray-300 hover:text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="space-y-1 border-t border-gray-100 p-3 text-sm dark:border-gray-700">
            <Row label="รวมย่อย" value={`฿${formatBaht(order.subtotal_satang)}`} />
            {order.discount_satang > 0 && <Row label="ส่วนลด" value={`−฿${formatBaht(order.discount_satang)}`} muted />}
            {order.service_charge_satang > 0 && <Row label="Service Charge" value={`฿${formatBaht(order.service_charge_satang)}`} />}
            {order.vat_satang > 0 && <Row label="VAT" value={`฿${formatBaht(order.vat_satang)}`} />}
            <div className="flex justify-between pt-1 text-base font-bold">
              <span>ยอดสุทธิ</span>
              <span className="font-mono text-indigo-600 dark:text-indigo-400">฿{formatBaht(order.total_satang)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2">
              <Button variant="outline" size="sm" icon={<Move className="h-4 w-4" />} onClick={() => setModal('move')}>ย้ายโต๊ะ</Button>
              <Button variant="outline" size="sm" icon={<Percent className="h-4 w-4" />} onClick={() => setModal('discount')}>ส่วนลด</Button>
              <Button variant="outline" size="sm" icon={<Ticket className="h-4 w-4" />} onClick={() => setModal('promo')}>โค้ดโปร</Button>
            </div>
            <Button variant="outline" className="mt-1 w-full" icon={<ChefHat className="h-4 w-4" />} disabled={cart.length === 0 || sending} onClick={sendKitchen}>
              ส่งครัว/บาร์
            </Button>
            <Button className="mt-1 w-full" icon={<Wallet className="h-4 w-4" />} disabled={cart.length === 0} onClick={() => setModal('checkout')}>
              คิดเงิน ฿{formatBaht(order.total_satang)}
            </Button>
          </div>
        </div>
      </div>

      {modal === 'checkout' && (
        <CheckoutModal orderId={orderId} totalSatang={order.total_satang} onClose={() => setModal(null)} onPaid={() => { setModal(null); onBack(); }} />
      )}
      {modal === 'move' && (
        <MoveTableModal orderId={orderId} storeId={storeId} currentTableId={order.table_id} onClose={() => setModal(null)} onMoved={() => { setModal(null); refreshOrder(); }} />
      )}
      {modal === 'discount' && (
        <DiscountModal current={order.discount_satang} onClose={() => setModal(null)} onApply={async (satang) => { await patchOrder({ discountSatang: satang }); setModal(null); }} />
      )}
      {modal === 'promo' && (
        <PromoModal orderId={orderId} hasPromo={!!order.promo_id} onClose={() => setModal(null)} onChanged={(o) => { setOrder(o); setModal(null); }} />
      )}
      {modMenu && (
        <ModifierDialog
          menuItemId={modMenu.id}
          menuName={modMenu.name}
          basePriceSatang={modMenu.price_satang}
          onClose={() => setModMenu(null)}
          onConfirm={(optionIds) => {
            const m = modMenu;
            setModMenu(null);
            addItem(m.id, optionIds);
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-gray-400' : 'text-gray-600 dark:text-gray-300'}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function MoveTableModal({ orderId, storeId, currentTableId, onClose, onMoved }: { orderId: string; storeId: string; currentTableId: string | null; onClose: () => void; onMoved: () => void }) {
  const [tables, setTables] = useState<PosTable[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/pos/bootstrap?storeId=${storeId}`)
      .then((r) => r.json())
      .then((d) => {
        setTables((d.tables as PosTable[]) ?? []);
        const occupied = new Set<string>();
        for (const o of (d.openOrders as PosOrder[]) ?? []) if (o.table_id && o.id !== orderId) occupied.add(o.table_id);
        setBusyIds(occupied);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [storeId, orderId]);

  const move = async (tableId: string) => {
    const res = await fetch(`/api/pos/orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tableId }) });
    if (res.ok) onMoved();
    else toast({ type: 'error', title: 'ย้ายไม่สำเร็จ' });
  };

  return (
    <Modal isOpen onClose={onClose} title="ย้ายโต๊ะ" size="md">
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {tables.map((t) => {
            const occupied = busyIds.has(t.id);
            const current = t.id === currentTableId;
            return (
              <button
                key={t.id}
                disabled={occupied || current}
                onClick={() => move(t.id)}
                className={`rounded-xl border-2 py-3 text-center text-sm font-semibold transition ${
                  current ? 'border-indigo-400 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20'
                  : occupied ? 'border-gray-200 bg-gray-50 text-gray-300 dark:border-gray-700 dark:bg-gray-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20'
                }`}
              >
                {t.name}
                {current && <span className="block text-[10px] font-normal">โต๊ะนี้</span>}
                {occupied && <span className="block text-[10px] font-normal">ไม่ว่าง</span>}
              </button>
            );
          })}
        </div>
      )}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ปิด</Button>
      </ModalFooter>
    </Modal>
  );
}

function DiscountModal({ current, onClose, onApply }: { current: number; onClose: () => void; onApply: (satang: number) => void }) {
  const [val, setVal] = useState(current ? String(current / 100) : '');
  return (
    <Modal isOpen onClose={onClose} title="ส่วนลดทั้งบิล" size="sm">
      <div className="space-y-3">
        <Input label="ส่วนลด (บาท)" value={val} onChange={(e) => setVal(e.target.value)} placeholder="0" inputMode="decimal" />
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={() => onApply(val ? bahtToSatang(Number(val)) : 0)}>ใช้ส่วนลด</Button>
      </ModalFooter>
    </Modal>
  );
}

function PromoModal({ orderId, hasPromo, onClose, onChanged }: { orderId: string; hasPromo: boolean; onClose: () => void; onChanged: (order: PosOrder) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    if (!code.trim()) return toast({ type: 'error', title: 'ใส่โค้ด' });
    setBusy(true);
    try {
      const res = await fetch(`/api/pos/orders/${orderId}/promo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'ใช้โค้ดไม่สำเร็จ');
      toast({ type: 'success', title: 'ใช้โค้ดแล้ว' });
      onChanged(d.order);
    } catch (e) {
      toast({ type: 'error', title: 'ผิดพลาด', message: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/pos/orders/${orderId}/promo`, { method: 'DELETE' });
      const d = await res.json();
      if (res.ok) {
        toast({ type: 'success', title: 'เอาโค้ดออกแล้ว' });
        onChanged(d.order);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="โค้ดโปรโมชั่น" size="sm">
      {hasPromo ? (
        <div className="space-y-3">
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">บิลนี้ใช้โค้ดส่วนลดอยู่แล้ว</p>
          <Button variant="danger" onClick={remove} isLoading={busy} className="w-full">เอาโค้ดออก</Button>
        </div>
      ) : (
        <Input label="โค้ด" value={code} onChange={(e) => setCode(e.target.value)} placeholder="เช่น SAVE10" />
      )}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>ปิด</Button>
        {!hasPromo && <Button onClick={apply} isLoading={busy}>ใช้โค้ด</Button>}
      </ModalFooter>
    </Modal>
  );
}
