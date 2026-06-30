import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getInvContext, isInvMgmt } from '@/lib/inventory/guard';

// GET /api/inventory/store-products?storeId= — สินค้าที่สาขานี้มี (+ ยอดคงเหลือ)
export async function GET(request: NextRequest) {
  const { supabase, user } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const storeId = request.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });

  const [{ data: rows, error }, { data: bals }] = await Promise.all([
    supabase
      .from('inv_store_products')
      .select('*, product:inv_products(*)')
      .eq('store_id', storeId)
      .order('created_at'),
    supabase.from('inv_stock_balances').select('product_id, qty').eq('store_id', storeId),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const balMap = new Map(((bals as { product_id: string; qty: number }[]) ?? []).map((b) => [b.product_id, b.qty]));
  const storeProducts = ((rows as { product_id: string }[]) ?? []).map((r) => ({
    ...r,
    balance: balMap.get(r.product_id) ?? 0,
  }));
  return NextResponse.json({ storeProducts });
}

interface LinkBody {
  storeId?: string;
  productId?: string;
  productIds?: string[];
  storeSku?: string;
  storeName?: string;
}

// POST /api/inventory/store-products — ผูกสินค้า master เข้าสาขา (ทีละชิ้น หรือหลายชิ้น)
export async function POST(request: NextRequest) {
  const { supabase, user, role } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isInvMgmt(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ/บัญชี' }, { status: 403 });

  let body: LinkBody;
  try {
    body = (await request.json()) as LinkBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });

  // โหมดหลายชิ้น (ผูกทีเดียว ข้ามตัวที่ผูกแล้ว)
  if (Array.isArray(body.productIds) && body.productIds.length > 0) {
    const rows = [...new Set(body.productIds)].map((pid) => ({ store_id: body.storeId!, product_id: pid }));
    const { error } = await supabase
      .from('inv_store_products')
      .upsert(rows, { onConflict: 'store_id,product_id', ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, linked: rows.length });
  }

  if (!body.productId) return NextResponse.json({ error: 'ต้องระบุสินค้า' }, { status: 400 });
  const { data, error } = await supabase
    .from('inv_store_products')
    .insert({
      store_id: body.storeId,
      product_id: body.productId,
      store_sku: body.storeSku?.trim() || null,
      store_name: body.storeName?.trim() || null,
    })
    .select('*, product:inv_products(*)')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'สินค้านี้ถูกผูกกับสาขานี้แล้ว' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ storeProduct: data });
}
