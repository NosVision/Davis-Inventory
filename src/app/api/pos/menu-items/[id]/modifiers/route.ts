import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getPosContext, isPosManager } from '@/lib/pos/guard';

// GET /api/pos/menu-items/[id]/modifiers — กลุ่มตัวเลือกที่ผูกกับเมนูนี้ (+ options)
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('pos_menu_item_modifiers')
    .select('sort, group:pos_modifier_groups(*, options:pos_modifier_options(*))')
    .eq('menu_item_id', id)
    .order('sort');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const groups = ((data ?? []) as { group: unknown }[]).map((r) => r.group).filter(Boolean);
  return NextResponse.json({ groups });
}

interface PutBody {
  groupIds?: string[];
}

// PUT /api/pos/menu-items/[id]/modifiers — ตั้งกลุ่มตัวเลือกที่ใช้กับเมนูนี้ (แทนที่)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, role } = await getPosContext();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPosManager(role)) return NextResponse.json({ error: 'เฉพาะเจ้าของ/ผู้จัดการ' }, { status: 403 });

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const groupIds = [...new Set((body.groupIds ?? []).filter(Boolean))];

  await supabase.from('pos_menu_item_modifiers').delete().eq('menu_item_id', id);
  if (groupIds.length > 0) {
    const { error } = await supabase
      .from('pos_menu_item_modifiers')
      .insert(groupIds.map((gid, i) => ({ menu_item_id: id, group_id: gid, sort: i })));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, groupIds });
}
