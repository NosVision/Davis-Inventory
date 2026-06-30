import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPosContext, isPosManager } from '@/lib/pos/guard';

const SEL = '*, options:pos_modifier_options(*)';

// GET /api/pos/modifier-groups?storeId= — กลุ่มตัวเลือก + ตัวเลือกในกลุ่ม
export async function GET(request: NextRequest) {
  const { supabase, user } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const storeId = request.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });
  const { data, error } = await supabase.from('pos_modifier_groups').select(SEL).eq('store_id', storeId).order('sort');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ groups: data ?? [] });
}

interface CreateBody {
  storeId?: string;
  name?: string;
  minSelect?: number;
  maxSelect?: number;
  required?: boolean;
}

// POST /api/pos/modifier-groups — เพิ่มกลุ่มตัวเลือก
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
  if (!body.storeId || !body.name?.trim()) return NextResponse.json({ error: 'ต้องระบุสาขาและชื่อกลุ่ม' }, { status: 400 });

  const { data: maxRow } = await supabase
    .from('pos_modifier_groups')
    .select('sort')
    .eq('store_id', body.storeId)
    .order('sort', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort = ((maxRow as { sort?: number } | null)?.sort ?? -1) + 1;

  const { data, error } = await supabase
    .from('pos_modifier_groups')
    .insert({
      store_id: body.storeId,
      name: body.name.trim(),
      min_select: typeof body.minSelect === 'number' ? Math.max(0, body.minSelect) : 0,
      max_select: typeof body.maxSelect === 'number' ? Math.max(1, body.maxSelect) : 1,
      required: !!body.required,
      sort,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ group: data });
}
