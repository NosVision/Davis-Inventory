import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const RECIPE_SELECT = '*, product:inv_products(id, sku, name, unit, kind)';
const MGMT_ROLES = ['owner', 'manager', 'accountant'];

// GET /api/pos/menu-items/[id]/recipes — สูตร (วัตถุดิบ) ของเมนูนี้
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase.from('pos_recipes').select(RECIPE_SELECT).eq('menu_item_id', id).order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ recipes: data ?? [] });
}

interface PutBody {
  lines: { invProductId: string; qty: number }[];
}

// PUT /api/pos/menu-items/[id]/recipes — ตั้งสูตรใหม่ทั้งชุด (แทนที่ของเดิม)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (!MGMT_ROLES.includes((prof as { role?: string } | null)?.role ?? '')) {
    return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ/บัญชี' }, { status: 403 });
  }

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // กันวัตถุดิบซ้ำในเมนูเดียว (เก็บอันหลังสุด) + qty > 0
  const byProduct = new Map<string, number>();
  for (const l of body.lines ?? []) {
    if (l?.invProductId && Number(l.qty) > 0) byProduct.set(l.invProductId, Number(l.qty));
  }

  await supabase.from('pos_recipes').delete().eq('menu_item_id', id);
  if (byProduct.size > 0) {
    const { error } = await supabase
      .from('pos_recipes')
      .insert([...byProduct.entries()].map(([pid, qty]) => ({ menu_item_id: id, inv_product_id: pid, qty })));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data } = await supabase.from('pos_recipes').select(RECIPE_SELECT).eq('menu_item_id', id).order('created_at');
  return NextResponse.json({ recipes: data ?? [] });
}
