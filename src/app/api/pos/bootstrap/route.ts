import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/pos/bootstrap?storeId= — โหลดข้อมูลหน้าจอ POS (สาขา/โซน/โต๊ะ/เมนู/บิลที่เปิดอยู่)
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const storeId = request.nextUrl.searchParams.get('storeId');

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const isOwner = profile?.role === 'owner';

  const { data: storesData } = await supabase
    .from('stores')
    .select('id, store_name')
    .eq('active', true)
    .order('store_name');
  let stores = ((storesData as { id: string; store_name: string }[]) ?? []).map((s) => ({
    id: s.id,
    name: s.store_name,
  }));
  if (!isOwner) {
    const { data: us } = await supabase.from('user_stores').select('store_id').eq('user_id', user.id);
    const allowed = new Set(((us as { store_id: string }[]) ?? []).map((r) => r.store_id));
    stores = stores.filter((s) => allowed.has(s.id));
  }

  if (!storeId) {
    return NextResponse.json({ stores, zones: [], tables: [], categories: [], items: [], openOrders: [] });
  }

  const [zonesRes, tablesRes, catsRes, itemsRes, ordersRes] = await Promise.all([
    supabase.from('pos_zones').select('*').eq('store_id', storeId).eq('active', true).order('sort'),
    supabase.from('pos_tables').select('*').eq('store_id', storeId).eq('active', true).order('sort'),
    supabase.from('menu_categories').select('*').eq('store_id', storeId).eq('active', true).order('sort'),
    supabase.from('menu_items').select('*').eq('store_id', storeId).eq('active', true).order('sort'),
    supabase.from('pos_orders').select('*').eq('store_id', storeId).eq('status', 'open'),
  ]);

  // เมนูไหนมีตัวเลือก (modifiers) — จอขายจะเปิด dialog เมื่อแตะเมนูเหล่านี้
  const menuItems = (itemsRes.data ?? []) as { id: string }[];
  let modifierMenuIds: string[] = [];
  if (menuItems.length > 0) {
    const { data: mim } = await supabase
      .from('pos_menu_item_modifiers')
      .select('menu_item_id')
      .in('menu_item_id', menuItems.map((m) => m.id));
    modifierMenuIds = [...new Set(((mim as { menu_item_id: string }[]) ?? []).map((r) => r.menu_item_id))];
  }

  return NextResponse.json({
    stores,
    zones: zonesRes.data ?? [],
    tables: tablesRes.data ?? [],
    categories: catsRes.data ?? [],
    items: itemsRes.data ?? [],
    openOrders: ordersRes.data ?? [],
    modifierMenuIds,
  });
}
