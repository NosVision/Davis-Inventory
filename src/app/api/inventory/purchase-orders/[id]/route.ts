import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getInvContext, isInvMgmt } from '@/lib/inventory/guard';
import { sendBotMessage } from '@/lib/chat/bot';

const PO_SELECT =
  '*, items:inv_purchase_order_items(*, product:inv_products(id, sku, name, unit, kind)), supplier:inv_suppliers(name)';

interface PoItemRow {
  id: string;
  product_id: string;
  qty_ordered: number;
  qty_received: number;
  unit_cost_satang: number | null;
}
interface PatchBody {
  action: 'receive' | 'cancel';
  items?: { itemId: string; qtyReceived: number }[];
  photoUrl?: string;
  note?: string;
}

// GET /api/inventory/purchase-orders/[id]
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { data, error } = await supabase.from('inv_purchase_orders').select(PO_SELECT).eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 });
  return NextResponse.json({ purchaseOrder: data });
}

// PATCH /api/inventory/purchase-orders/[id] — รับของ (→ +HQ ledger) / ยกเลิก
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, role } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isInvMgmt(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ/บัญชี' }, { status: 403 });

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: poRow } = await svc.from('inv_purchase_orders').select('id, status, po_code').eq('id', id).maybeSingle();
  const po = poRow as { id: string; status: string; po_code: string | null } | null;
  if (!po) return NextResponse.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 });

  const audit = async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      await svc.from('audit_logs').insert({
        action_type: action,
        table_name: 'inv_purchase_orders',
        record_id: id,
        new_value: { po_code: po.po_code, ...extra },
        changed_by: user.id,
      });
    } catch {
      // ignore
    }
  };

  // ── รับของ → post +HQ ──
  if (body.action === 'receive') {
    if (!['submitted', 'partial'].includes(po.status)) {
      return NextResponse.json({ error: 'ใบสั่งซื้อนี้รับของไม่ได้ (สถานะไม่ถูกต้อง)' }, { status: 400 });
    }
    const { data: hq } = await svc.from('stores').select('id').eq('is_central', true).maybeSingle();
    const hqId = (hq as { id: string } | null)?.id;
    if (!hqId) return NextResponse.json({ error: 'ไม่พบคลัง HQ (สาขากลาง)' }, { status: 400 });

    const { data: itemRows } = await svc
      .from('inv_purchase_order_items')
      .select('id, product_id, qty_ordered, qty_received, unit_cost_satang')
      .eq('po_id', id);
    const items = (itemRows as PoItemRow[]) ?? [];
    const recvMap = new Map((body.items ?? []).map((r) => [r.itemId, Number(r.qtyReceived)]));

    const moves: Record<string, unknown>[] = [];
    const updates: { id: string; qty_received: number }[] = [];
    for (const it of items) {
      const remaining = it.qty_ordered - it.qty_received;
      // ถ้าไม่ส่ง items มา = รับเต็มส่วนที่เหลือ
      const recv = body.items ? Math.max(0, Math.min(recvMap.get(it.id) ?? 0, remaining)) : remaining;
      if (recv <= 0) continue;
      moves.push({
        store_id: hqId,
        product_id: it.product_id,
        qty: recv,
        reason: 'po_receive',
        ref_type: 'purchase_order',
        ref_id: id,
        unit_cost_satang: it.unit_cost_satang,
        created_by: user.id,
      });
      updates.push({ id: it.id, qty_received: it.qty_received + recv });
    }
    if (moves.length === 0) return NextResponse.json({ error: 'ไม่มีจำนวนที่รับเข้า' }, { status: 400 });

    const { error: movErr } = await svc.from('inv_stock_movements').insert(moves);
    if (movErr) return NextResponse.json({ error: movErr.message }, { status: 500 });
    await Promise.all(updates.map((u) => svc.from('inv_purchase_order_items').update({ qty_received: u.qty_received }).eq('id', u.id)));
    await svc.from('inv_po_receipts').insert({ po_id: id, received_by: user.id, photo_url: body.photoUrl || null, note: body.note?.trim() || null });

    // ครบทุกตัวหรือยัง
    const fullyReceived = items.every((it) => {
      const u = updates.find((x) => x.id === it.id);
      const got = u ? u.qty_received : it.qty_received;
      return got >= it.qty_ordered;
    });
    await svc.from('inv_purchase_orders').update({ status: fullyReceived ? 'received' : 'partial' }).eq('id', id);
    await audit('INV_PO_RECEIVED', { lines: moves.length, fully: fullyReceived });
    try {
      await sendBotMessage({
        storeId: hqId,
        type: 'system',
        content: `📦 รับของ ${po.po_code} เข้าคลัง HQ แล้ว${fullyReceived ? ' (ครบ)' : ' (บางส่วน)'}`,
      });
    } catch {
      // ignore
    }

    const { data } = await svc.from('inv_purchase_orders').select(PO_SELECT).eq('id', id).single();
    return NextResponse.json({ purchaseOrder: data });
  }

  // ── ยกเลิก ──
  if (body.action === 'cancel') {
    if (po.status === 'received') return NextResponse.json({ error: 'ใบที่รับของแล้วยกเลิกไม่ได้' }, { status: 400 });
    await svc.from('inv_purchase_orders').update({ status: 'cancelled' }).eq('id', id);
    await audit('INV_PO_CANCELLED');
    const { data } = await svc.from('inv_purchase_orders').select(PO_SELECT).eq('id', id).single();
    return NextResponse.json({ purchaseOrder: data });
  }

  return NextResponse.json({ error: `ไม่รู้จัก action: ${body.action}` }, { status: 400 });
}
