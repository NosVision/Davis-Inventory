import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPosContext, isPosManager } from '@/lib/pos/guard';

const STATIONS = ['kitchen', 'bar'];

// GET /api/pos/menu-categories?storeId= — หมวดเมนู (รวมที่ปิด)
export async function GET(request: NextRequest) {
  const { supabase, user } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const storeId = request.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });
  const { data, error } = await supabase.from('menu_categories').select('*').eq('store_id', storeId).order('sort');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ categories: data ?? [] });
}

// POST /api/pos/menu-categories — เพิ่มหมวด
export async function POST(request: NextRequest) {
  const { supabase, user, role } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPosManager(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ' }, { status: 403 });

  let body: { storeId?: string; name?: string; station?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.storeId || !body.name?.trim()) return NextResponse.json({ error: 'ต้องระบุสาขาและชื่อหมวด' }, { status: 400 });

  const { data: maxRow } = await supabase
    .from('menu_categories')
    .select('sort')
    .eq('store_id', body.storeId)
    .order('sort', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort = ((maxRow as { sort?: number } | null)?.sort ?? -1) + 1;

  const { data, error } = await supabase
    .from('menu_categories')
    .insert({ store_id: body.storeId, name: body.name.trim(), station: STATIONS.includes(body.station ?? '') ? body.station : null, sort })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: data });
}
