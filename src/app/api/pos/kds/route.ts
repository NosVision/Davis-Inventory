import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/pos/kds?storeId=&station= — ตั๋วที่ส่งครัว/บาร์แล้วยังไม่เสร็จ
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const storeId = sp.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });
  const station = sp.get('station');

  let q = supabase
    .from('pos_order_items')
    .select(
      'id, name, qty, station, sent_at, note, modifiers:pos_order_item_modifiers(name), order:pos_orders!inner(id, order_no, table_id, status, store_id, table:pos_tables(name))',
    )
    .not('sent_at', 'is', null)
    .is('done_at', null)
    .eq('order.store_id', storeId)
    .in('order.status', ['open', 'paid'])
    .order('sent_at');
  if (station && station !== 'all') q = q.eq('station', station);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tickets: data ?? [] });
}
