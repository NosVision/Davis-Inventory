import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getInvContext } from '@/lib/inventory/guard';
import type { InvMovementReason } from '@/types/inventory';

// เหตุผลที่อนุญาตให้ "ปรับมือ" ได้ (กันโพสต์ sale/po/requisition ตรง ๆ)
const MANUAL_REASONS: InvMovementReason[] = ['opening', 'count_adjust', 'waste', 'transfer', 'manual'];

// GET /api/inventory/movements?storeId=&productId= — บัญชีเดินสต๊อก (ล่าสุดก่อน)
export async function GET(request: NextRequest) {
  const { supabase, user } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const storeId = sp.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });

  let q = supabase
    .from('inv_stock_movements')
    .select('*, product:inv_products(id, sku, name, unit)')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(200);
  const productId = sp.get('productId');
  if (productId) q = q.eq('product_id', productId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ movements: data ?? [] });
}

interface MoveBody {
  storeId?: string;
  productId?: string;
  qty?: number;
  reason?: InvMovementReason;
  note?: string;
}

// POST /api/inventory/movements — ปรับสต๊อกมือ/ตั้งต้น/ของเสีย (post เข้า ledger)
export async function POST(request: NextRequest) {
  const { supabase, user } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: MoveBody;
  try {
    body = (await request.json()) as MoveBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.storeId || !body.productId) {
    return NextResponse.json({ error: 'ต้องระบุสาขาและสินค้า' }, { status: 400 });
  }
  if (typeof body.qty !== 'number' || !Number.isFinite(body.qty) || body.qty === 0) {
    return NextResponse.json({ error: 'จำนวนต้องไม่เป็นศูนย์ (+ เข้า / - ออก)' }, { status: 400 });
  }
  const reason: InvMovementReason = MANUAL_REASONS.includes(body.reason as InvMovementReason)
    ? (body.reason as InvMovementReason)
    : 'manual';

  // ต้องผูกสินค้ากับสาขานี้ก่อน (กันโพสต์ของที่สาขาไม่ได้ขาย/เก็บ)
  const { data: link } = await supabase
    .from('inv_store_products')
    .select('id')
    .eq('store_id', body.storeId)
    .eq('product_id', body.productId)
    .maybeSingle();
  if (!link) {
    return NextResponse.json({ error: 'สินค้านี้ยังไม่ได้ผูกกับสาขา — ผูกในแคตตาล็อกก่อน' }, { status: 400 });
  }

  const { error } = await supabase.from('inv_stock_movements').insert({
    store_id: body.storeId,
    product_id: body.productId,
    qty: body.qty,
    reason,
    ref_type: 'manual',
    note: body.note?.trim() || null,
    created_by: user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: bal } = await supabase
    .from('inv_stock_balances')
    .select('qty')
    .eq('store_id', body.storeId)
    .eq('product_id', body.productId)
    .maybeSingle();
  return NextResponse.json({ ok: true, balance: (bal as { qty: number } | null)?.qty ?? 0 });
}
