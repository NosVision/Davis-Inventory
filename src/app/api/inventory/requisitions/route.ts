import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyStoreStaff, STORE_STAFF_ROLES } from '@/lib/notifications/service';
import { sendBotMessage } from '@/lib/chat/bot';
import { isCrossVenueRole } from '@/types/roles';

const REQ_SELECT =
  '*, items:inv_requisition_items(*, product:inv_products(id, sku, name, unit, kind)), store:stores(store_name, store_code)';

interface ReqItemInput {
  productId: string;
  requestedQty: number;
  note?: string;
}
interface CreateBody {
  storeId: string;
  items: ReqItemInput[];
  note?: string;
}

// GET /api/inventory/requisitions?storeId=&status= — รายการใบเบิก (scope ตาม RLS)
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  let q = supabase.from('inv_requisitions').select(REQ_SELECT).order('created_at', { ascending: false }).limit(200);
  const storeId = sp.get('storeId');
  const status = sp.get('status');
  if (storeId) q = q.eq('store_id', storeId);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requisitions: data ?? [] });
}

// POST /api/inventory/requisitions — สาขาเปิดใบเบิก (status=submitted)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });
  const items = (body.items ?? []).filter((i) => i?.productId && Number(i.requestedQty) > 0);
  if (items.length === 0) return NextResponse.json({ error: 'ต้องมีรายการอย่างน้อย 1 รายการ' }, { status: 400 });

  // สิทธิ์: เป็นสมาชิกของสาขานั้น หรือฝ่ายจัดการ หรือเป็น role ข้ามสาขา (จัดซื้อ/บัญชี/HR/เจ้าของ)
  const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const role = (prof as { role?: string } | null)?.role ?? '';
  const mgmt = ['owner', 'manager', 'accountant'].includes(role);
  if (!mgmt && !isCrossVenueRole(role)) {
    const { data: us } = await supabase
      .from('user_stores')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('store_id', body.storeId)
      .maybeSingle();
    if (!us) return NextResponse.json({ error: 'คุณไม่มีสิทธิ์เปิดใบเบิกให้สาขานี้' }, { status: 403 });
  }

  const svc = createServiceClient();
  const { data: store } = await svc.from('stores').select('store_code').eq('id', body.storeId).single();
  const code = (store as { store_code?: string } | null)?.store_code || 'XXX';
  const { data: no, error: noErr } = await svc.rpc('next_inv_doc_no', { p_scope: `req:${code}` });
  if (noErr) return NextResponse.json({ error: noErr.message }, { status: 500 });
  const reqCode = `PR-${code}-${String(no as number).padStart(4, '0')}`;

  const { data: req, error } = await svc
    .from('inv_requisitions')
    .insert({
      store_id: body.storeId,
      req_code: reqCode,
      status: 'submitted',
      requested_by: user.id,
      note: body.note?.trim() || null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { error: itemsErr } = await svc.from('inv_requisition_items').insert(
    items.map((i) => ({
      req_id: req.id,
      product_id: i.productId,
      requested_qty: i.requestedQty,
      note: i.note?.trim() || null,
    })),
  );
  if (itemsErr) {
    await svc.from('inv_requisitions').delete().eq('id', req.id);
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  // แจ้งเตือน HQ — in-app + chat (LINE flex/การ์ดกดได้ เพิ่มตอน go-live)
  const { data: hq } = await svc.from('stores').select('id').eq('is_central', true).maybeSingle();
  const hqId = (hq as { id: string } | null)?.id;
  if (hqId) {
    try {
      await notifyStoreStaff({
        storeId: hqId,
        type: 'approval_request',
        title: '📦 มีใบเบิกใหม่รออนุมัติ',
        body: `${reqCode} · ${items.length} รายการ`,
        data: { reqId: req.id, url: '/inventory/requisitions' },
        excludeUserId: user.id,
        // + จัดซื้อ (hq) — คนที่อนุมัติใบเบิกจริง ๆ ซึ่งไม่เคยอยู่ใน role ปริยายของคลังกลาง
        roles: [...STORE_STAFF_ROLES, 'hq'],
      });
    } catch {
      // ignore
    }
    try {
      await sendBotMessage({
        storeId: hqId,
        type: 'system',
        content: `📦 ใบเบิกใหม่ ${reqCode} · ${items.length} รายการ — รออนุมัติที่ /inventory`,
      });
    } catch {
      // ignore
    }
  }

  try {
    await svc.from('audit_logs').insert({
      store_id: body.storeId,
      action_type: 'INV_REQ_CREATED',
      table_name: 'inv_requisitions',
      record_id: req.id,
      new_value: { req_code: reqCode, items: items.length },
      changed_by: user.id,
    });
  } catch {
    // ignore
  }

  return NextResponse.json({ requisition: req });
}
