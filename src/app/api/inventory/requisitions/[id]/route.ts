import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyStoreStaff } from '@/lib/notifications/service';
import { sendBotMessage } from '@/lib/chat/bot';

const REQ_SELECT =
  '*, items:inv_requisition_items(*, product:inv_products(id, sku, name, unit, kind)), store:stores(store_name, store_code)';

interface ReqItemRow {
  id: string;
  product_id: string;
  requested_qty: number;
  approved_qty: number | null;
}
interface PatchBody {
  action: 'approve' | 'reject' | 'fulfill' | 'cancel';
  reason?: string;
  approvedItems?: { itemId: string; approvedQty: number }[];
}

const MGMT_ROLES = ['owner', 'manager', 'accountant'];

// GET /api/inventory/requisitions/[id] — รายละเอียดใบเบิก
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase.from('inv_requisitions').select(REQ_SELECT).eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'ไม่พบใบเบิก' }, { status: 404 });
  return NextResponse.json({ requisition: data });
}

// PATCH /api/inventory/requisitions/[id] — อนุมัติ/ปฏิเสธ/จ่ายของ/ยกเลิก
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.action) return NextResponse.json({ error: 'ต้องระบุ action' }, { status: 400 });

  const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const role = (prof as { role?: string } | null)?.role ?? '';
  const isMgmt = MGMT_ROLES.includes(role);

  const svc = createServiceClient();
  const { data: reqRow } = await svc.from('inv_requisitions').select('*').eq('id', id).maybeSingle();
  const req = reqRow as { id: string; store_id: string; status: string; req_code: string | null } | null;
  if (!req) return NextResponse.json({ error: 'ไม่พบใบเบิก' }, { status: 404 });

  const notifyBranch = async (title: string, bodyText: string) => {
    try {
      await notifyStoreStaff({
        storeId: req.store_id,
        type: 'approval_request',
        title,
        body: bodyText,
        data: { reqId: id, url: '/inventory/requisitions' },
        excludeUserId: user.id,
      });
    } catch {
      // ignore
    }
    try {
      await sendBotMessage({ storeId: req.store_id, type: 'system', content: `${title} — ${bodyText}` });
    } catch {
      // ignore
    }
  };
  const audit = async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      await svc.from('audit_logs').insert({
        store_id: req.store_id,
        action_type: action,
        table_name: 'inv_requisitions',
        record_id: id,
        new_value: { req_code: req.req_code, ...extra },
        changed_by: user.id,
      });
    } catch {
      // ignore
    }
  };

  // ── อนุมัติ (HQ) ──
  if (body.action === 'approve') {
    if (!isMgmt) return NextResponse.json({ error: 'เฉพาะฝ่ายจัดการ/HQ' }, { status: 403 });
    if (req.status !== 'submitted') return NextResponse.json({ error: 'ใบเบิกไม่ได้อยู่สถานะรออนุมัติ' }, { status: 400 });

    // ตั้ง approved_qty รายตัว (ไม่ระบุ = ตามที่ขอ)
    const { data: itemRows } = await svc.from('inv_requisition_items').select('id, requested_qty').eq('req_id', id);
    const approveMap = new Map((body.approvedItems ?? []).map((a) => [a.itemId, a.approvedQty]));
    await Promise.all(
      ((itemRows as { id: string; requested_qty: number }[]) ?? []).map((it) =>
        svc
          .from('inv_requisition_items')
          .update({ approved_qty: approveMap.has(it.id) ? Math.max(0, approveMap.get(it.id)!) : it.requested_qty })
          .eq('id', it.id),
      ),
    );
    await svc.from('inv_requisitions').update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() }).eq('id', id);
    await notifyBranch('✅ ใบเบิกได้รับอนุมัติ', `${req.req_code} อนุมัติแล้ว รอจ่ายของ`);
    await audit('INV_REQ_APPROVED');
    const { data } = await svc.from('inv_requisitions').select(REQ_SELECT).eq('id', id).single();
    return NextResponse.json({ requisition: data });
  }

  // ── ปฏิเสธ (HQ) ──
  if (body.action === 'reject') {
    if (!isMgmt) return NextResponse.json({ error: 'เฉพาะฝ่ายจัดการ/HQ' }, { status: 403 });
    if (req.status !== 'submitted') return NextResponse.json({ error: 'ใบเบิกไม่ได้อยู่สถานะรออนุมัติ' }, { status: 400 });
    await svc.from('inv_requisitions').update({ status: 'rejected', note: body.reason?.trim() || null }).eq('id', id);
    await notifyBranch('❌ ใบเบิกถูกปฏิเสธ', `${req.req_code}${body.reason ? ` · ${body.reason}` : ''}`);
    await audit('INV_REQ_REJECTED', { reason: body.reason ?? null });
    const { data } = await svc.from('inv_requisitions').select(REQ_SELECT).eq('id', id).single();
    return NextResponse.json({ requisition: data });
  }

  // ── จ่ายของ (HQ) → post ledger (−HQ, +สาขา) ──
  if (body.action === 'fulfill') {
    if (!isMgmt) return NextResponse.json({ error: 'เฉพาะฝ่ายจัดการ/HQ' }, { status: 403 });
    if (req.status !== 'approved') return NextResponse.json({ error: 'ต้องอนุมัติก่อนจ่ายของ' }, { status: 400 });

    const { data: hq } = await svc.from('stores').select('id').eq('is_central', true).maybeSingle();
    const hqId = (hq as { id: string } | null)?.id;
    if (!hqId) return NextResponse.json({ error: 'ไม่พบคลัง HQ (สาขากลาง)' }, { status: 400 });

    const { data: itemRows } = await svc.from('inv_requisition_items').select('id, product_id, requested_qty, approved_qty').eq('req_id', id);
    const items = (itemRows as ReqItemRow[]) ?? [];
    const moves: Record<string, unknown>[] = [];
    for (const it of items) {
      const qty = it.approved_qty ?? it.requested_qty;
      if (!qty || qty <= 0) continue;
      moves.push({ store_id: hqId, product_id: it.product_id, qty: -qty, reason: 'requisition_out', ref_type: 'requisition', ref_id: id, created_by: user.id });
      moves.push({ store_id: req.store_id, product_id: it.product_id, qty, reason: 'requisition_in', ref_type: 'requisition', ref_id: id, created_by: user.id });
    }
    if (moves.length > 0) {
      const { error: movErr } = await svc.from('inv_stock_movements').insert(moves);
      if (movErr) return NextResponse.json({ error: movErr.message }, { status: 500 });
    }
    await Promise.all(items.map((it) => svc.from('inv_requisition_items').update({ fulfilled_qty: it.approved_qty ?? it.requested_qty }).eq('id', it.id)));
    await svc.from('inv_requisitions').update({ status: 'fulfilled' }).eq('id', id);
    await notifyBranch('📦 จ่ายของตามใบเบิกแล้ว', `${req.req_code} ตัดจากคลัง HQ เข้าสาขาเรียบร้อย`);
    await audit('INV_REQ_FULFILLED', { lines: moves.length / 2 });
    const { data } = await svc.from('inv_requisitions').select(REQ_SELECT).eq('id', id).single();
    return NextResponse.json({ requisition: data });
  }

  // ── ยกเลิก (สาขาเจ้าของ หรือ ฝ่ายจัดการ) ──
  if (body.action === 'cancel') {
    if (!['submitted', 'approved'].includes(req.status)) {
      return NextResponse.json({ error: 'ยกเลิกได้เฉพาะใบที่ยังไม่จ่ายของ' }, { status: 400 });
    }
    if (!isMgmt) {
      const { data: us } = await supabase
        .from('user_stores')
        .select('store_id')
        .eq('user_id', user.id)
        .eq('store_id', req.store_id)
        .maybeSingle();
      if (!us) return NextResponse.json({ error: 'คุณไม่มีสิทธิ์ยกเลิกใบเบิกนี้' }, { status: 403 });
    }
    await svc.from('inv_requisitions').update({ status: 'cancelled' }).eq('id', id);
    await audit('INV_REQ_CANCELLED');
    const { data } = await svc.from('inv_requisitions').select(REQ_SELECT).eq('id', id).single();
    return NextResponse.json({ requisition: data });
  }

  return NextResponse.json({ error: `ไม่รู้จัก action: ${body.action}` }, { status: 400 });
}
