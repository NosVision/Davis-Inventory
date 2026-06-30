import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPosContext, isPosManager } from '@/lib/pos/guard';

interface PatchBody {
  name?: string;
  priceSatang?: number;
  invProductId?: string | null;
  qty?: number | null;
  active?: boolean;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, role } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPosManager(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ' }, { status: 403 });

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const update: Record<string, unknown> = {};
  if (typeof body.name === 'string') update.name = body.name.trim();
  if (typeof body.priceSatang === 'number') update.price_satang = Math.max(0, Math.round(body.priceSatang));
  if ('invProductId' in body) update.inv_product_id = body.invProductId ?? null;
  if ('qty' in body) update.qty = typeof body.qty === 'number' && body.qty > 0 ? body.qty : null;
  if (typeof body.active === 'boolean') update.active = body.active;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' }, { status: 400 });

  const { data, error } = await supabase.from('pos_modifier_options').update(update).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ option: data });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, role } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPosManager(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ' }, { status: 403 });
  const { error } = await supabase.from('pos_modifier_options').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
