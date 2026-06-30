import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPosContext, isPosManager } from '@/lib/pos/guard';

interface CreateBody {
  groupId?: string;
  name?: string;
  priceSatang?: number;
  invProductId?: string | null;
  qty?: number | null;
}

// POST /api/pos/modifier-options — เพิ่มตัวเลือกในกลุ่ม (+ราคา, ผูกวัตถุดิบได้)
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
  if (!body.groupId || !body.name?.trim()) return NextResponse.json({ error: 'ต้องระบุกลุ่มและชื่อตัวเลือก' }, { status: 400 });

  const { data: maxRow } = await supabase
    .from('pos_modifier_options')
    .select('sort')
    .eq('group_id', body.groupId)
    .order('sort', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort = ((maxRow as { sort?: number } | null)?.sort ?? -1) + 1;

  const { data, error } = await supabase
    .from('pos_modifier_options')
    .insert({
      group_id: body.groupId,
      name: body.name.trim(),
      price_satang: typeof body.priceSatang === 'number' ? Math.max(0, Math.round(body.priceSatang)) : 0,
      inv_product_id: body.invProductId ?? null,
      qty: typeof body.qty === 'number' && body.qty > 0 ? body.qty : null,
      sort,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ option: data });
}
