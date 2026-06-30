import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPosContext, isPosManager } from '@/lib/pos/guard';

// GET /api/pos/menu-items?storeId= — เมนูทั้งหมด (รวมที่ปิด) สำหรับหน้าจัดการ
export async function GET(request: NextRequest) {
  const { supabase, user } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const storeId = request.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });
  const { data, error } = await supabase.from('menu_items').select('*').eq('store_id', storeId).order('sort');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

interface CreateBody {
  storeId?: string;
  categoryId?: string | null;
  name?: string;
  priceSatang?: number;
}

// POST /api/pos/menu-items — เพิ่มเมนู
export async function POST(request: NextRequest) {
  const { supabase, user, role } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPosManager(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ' }, { status: 403 });

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.storeId || !body.name?.trim()) return NextResponse.json({ error: 'ต้องระบุสาขาและชื่อเมนู' }, { status: 400 });

  const { data, error } = await supabase
    .from('menu_items')
    .insert({
      store_id: body.storeId,
      category_id: body.categoryId ?? null,
      name: body.name.trim(),
      price_satang: typeof body.priceSatang === 'number' ? Math.max(0, Math.round(body.priceSatang)) : 0,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
