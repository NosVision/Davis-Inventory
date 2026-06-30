import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

interface Body {
  available?: boolean;
  dailyLimit?: number | null;
}

// PATCH /api/pos/menu-items/[id]/availability — เปิด/ปิด (86) + โควตา/วัน
// อนุญาตพนักงานในสาขานั้น (ไม่ต้องเป็นผู้จัดการ) — ใช้ service client หลังเช็คสิทธิ์สาขา
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: mi } = await svc.from('menu_items').select('store_id').eq('id', id).maybeSingle();
  const storeId = (mi as { store_id?: string } | null)?.store_id;
  if (!storeId) return NextResponse.json({ error: 'ไม่พบเมนู' }, { status: 404 });

  // สิทธิ์: เจ้าของ หรือ เป็นสมาชิกของสาขานั้น
  const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if ((prof as { role?: string } | null)?.role !== 'owner') {
    const { data: us } = await supabase
      .from('user_stores')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('store_id', storeId)
      .maybeSingle();
    if (!us) return NextResponse.json({ error: 'คุณไม่มีสิทธิ์จัดการเมนูสาขานี้' }, { status: 403 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.available === 'boolean') update.available = body.available;
  if ('dailyLimit' in body) update.daily_limit = typeof body.dailyLimit === 'number' && body.dailyLimit > 0 ? Math.round(body.dailyLimit) : null;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' }, { status: 400 });

  const { error } = await svc.from('menu_items').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
