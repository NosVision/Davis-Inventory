import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getInvContext, isInvMgmt } from '@/lib/inventory/guard';
import { notifyStoreStaff } from '@/lib/notifications/service';
import { sendBotMessage } from '@/lib/chat/bot';

const PO_SELECT =
  '*, items:inv_purchase_order_items(*, product:inv_products(id, sku, name, unit, kind)), supplier:inv_suppliers(name)';

interface PoItemInput {
  productId: string;
  qtyOrdered: number;
  unitCostSatang?: number;
  note?: string;
}
interface CreateBody {
  supplierId?: string;
  items: PoItemInput[];
  note?: string;
}

// GET /api/inventory/purchase-orders?status= — รายการใบสั่งซื้อ (ฝ่ายจัดการ)
export async function GET(request: NextRequest) {
  const { supabase, user } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let q = supabase.from('inv_purchase_orders').select(PO_SELECT).order('created_at', { ascending: false }).limit(200);
  const status = request.nextUrl.searchParams.get('status');
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ purchaseOrders: data ?? [] });
}

// POST /api/inventory/purchase-orders — HQ เปิดใบสั่งซื้อ
export async function POST(request: NextRequest) {
  const { user, role } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isInvMgmt(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ/บัญชี' }, { status: 403 });

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const items = (body.items ?? []).filter((i) => i?.productId && Number(i.qtyOrdered) > 0);
  if (items.length === 0) return NextResponse.json({ error: 'ต้องมีรายการอย่างน้อย 1 รายการ' }, { status: 400 });

  const svc = createServiceClient();
  const { data: no, error: noErr } = await svc.rpc('next_inv_doc_no', { p_scope: 'po' });
  if (noErr) return NextResponse.json({ error: noErr.message }, { status: 500 });
  const poCode = `PO-${String(no as number).padStart(4, '0')}`;

  const { data: po, error } = await svc
    .from('inv_purchase_orders')
    .insert({
      po_code: poCode,
      supplier_id: body.supplierId || null,
      status: 'submitted',
      ordered_by: user.id,
      ordered_at: new Date().toISOString(),
      note: body.note?.trim() || null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { error: itemsErr } = await svc.from('inv_purchase_order_items').insert(
    items.map((i) => ({
      po_id: po.id,
      product_id: i.productId,
      qty_ordered: i.qtyOrdered,
      unit_cost_satang: typeof i.unitCostSatang === 'number' ? Math.max(0, Math.round(i.unitCostSatang)) : null,
      note: i.note?.trim() || null,
    })),
  );
  if (itemsErr) {
    await svc.from('inv_purchase_orders').delete().eq('id', po.id);
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  // แจ้งเตือน HQ — in-app + chat (LINE flex เพิ่มตอน go-live)
  const { data: hq } = await svc.from('stores').select('id').eq('is_central', true).maybeSingle();
  const hqId = (hq as { id: string } | null)?.id;
  if (hqId) {
    try {
      await notifyStoreStaff({
        storeId: hqId,
        type: 'approval_request',
        title: '🧾 เปิดใบสั่งซื้อใหม่',
        body: `${poCode} · ${items.length} รายการ`,
        data: { poId: po.id, url: '/inventory' },
        excludeUserId: user.id,
      });
    } catch {
      // ignore
    }
    try {
      await sendBotMessage({ storeId: hqId, type: 'system', content: `🧾 ใบสั่งซื้อใหม่ ${poCode} · ${items.length} รายการ` });
    } catch {
      // ignore
    }
  }

  try {
    await svc.from('audit_logs').insert({
      action_type: 'INV_PO_CREATED',
      table_name: 'inv_purchase_orders',
      record_id: po.id,
      new_value: { po_code: poCode, items: items.length },
      changed_by: user.id,
    });
  } catch {
    // ignore
  }

  return NextResponse.json({ purchaseOrder: po });
}
