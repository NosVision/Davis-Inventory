import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getInvContext, isInvMgmt } from '@/lib/inventory/guard';

interface PatchBody {
  storeSku?: string;
  storeName?: string;
  active?: boolean;
}

// PATCH /api/inventory/store-products/[id] — แก้ชื่อ/รหัสของสาขา / เปิด-ปิด
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, role } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isInvMgmt(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ/บัญชี' }, { status: 403 });

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.storeSku === 'string') update.store_sku = body.storeSku.trim() || null;
  if (typeof body.storeName === 'string') update.store_name = body.storeName.trim() || null;
  if (typeof body.active === 'boolean') update.active = body.active;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('inv_store_products')
    .update(update)
    .eq('id', id)
    .select('*, product:inv_products(*)')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ storeProduct: data });
}

// DELETE /api/inventory/store-products/[id] — เลิกผูกสินค้าออกจากสาขา
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, role } = await getInvContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isInvMgmt(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ/บัญชี' }, { status: 403 });

  const { error } = await supabase.from('inv_store_products').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
