import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPosContext, isPosManager } from '@/lib/pos/guard';

const SHAPES = ['square', 'circle', 'rect'];

interface PatchBody {
  name?: string;
  seats?: number | null;
  shape?: string;
  zoneId?: string | null;
  posX?: number | null;
  posY?: number | null;
  active?: boolean;
}

// PATCH /api/pos/tables/[id] — แก้ชื่อ/ที่นั่ง/รูปทรง/โซน/ตำแหน่ง/เปิด-ปิด
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
  if ('seats' in body) update.seats = typeof body.seats === 'number' ? body.seats : null;
  if (SHAPES.includes(body.shape ?? '')) update.shape = body.shape;
  if ('zoneId' in body) update.zone_id = body.zoneId ?? null;
  if ('posX' in body) update.pos_x = typeof body.posX === 'number' ? body.posX : null;
  if ('posY' in body) update.pos_y = typeof body.posY === 'number' ? body.posY : null;
  if (typeof body.active === 'boolean') update.active = body.active;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' }, { status: 400 });

  const { data, error } = await supabase.from('pos_tables').update(update).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ table: data });
}

// DELETE /api/pos/tables/[id]
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, role } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPosManager(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ' }, { status: 403 });
  const { error } = await supabase.from('pos_tables').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
