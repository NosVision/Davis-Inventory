import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPosContext, isPosManager } from '@/lib/pos/guard';

const SHAPES = ['square', 'circle', 'rect'];

// GET /api/pos/tables?storeId= — โต๊ะทั้งหมดของสาขา (รวมที่ปิดใช้)
export async function GET(request: NextRequest) {
  const { supabase, user } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const storeId = request.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });
  const { data, error } = await supabase.from('pos_tables').select('*').eq('store_id', storeId).order('sort');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tables: data ?? [] });
}

interface CreateBody {
  storeId?: string;
  zoneId?: string | null;
  name?: string;
  seats?: number;
  shape?: string;
  posX?: number;
  posY?: number;
}

// POST /api/pos/tables — เพิ่มโต๊ะ
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
  if (!body.storeId || !body.name?.trim()) return NextResponse.json({ error: 'ต้องระบุสาขาและชื่อโต๊ะ' }, { status: 400 });

  const { data, error } = await supabase
    .from('pos_tables')
    .insert({
      store_id: body.storeId,
      zone_id: body.zoneId ?? null,
      name: body.name.trim(),
      seats: typeof body.seats === 'number' ? body.seats : null,
      shape: SHAPES.includes(body.shape ?? '') ? body.shape : 'square',
      pos_x: typeof body.posX === 'number' ? body.posX : null,
      pos_y: typeof body.posY === 'number' ? body.posY : null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ table: data });
}
