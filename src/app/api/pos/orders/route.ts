import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface OpenOrderBody {
  storeId?: string;
  tableId?: string | null;
}

// POST /api/pos/orders — เปิดบิลใหม่ (ถ้าโต๊ะมีบิลเปิดอยู่แล้วคืนบิลเดิม กันเปิดซ้ำ)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: OpenOrderBody;
  try {
    body = (await request.json()) as OpenOrderBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });

  if (body.tableId) {
    const { data: existing } = await supabase
      .from('pos_orders')
      .select('*')
      .eq('store_id', body.storeId)
      .eq('table_id', body.tableId)
      .eq('status', 'open')
      .maybeSingle();
    if (existing) return NextResponse.json({ order: existing, reused: true });
  }

  const { data: no, error: noErr } = await supabase.rpc('next_pos_order_no', { p_store: body.storeId });
  if (noErr) return NextResponse.json({ error: noErr.message }, { status: 500 });

  const { data: order, error } = await supabase
    .from('pos_orders')
    .insert({
      store_id: body.storeId,
      table_id: body.tableId ?? null,
      order_no: no as number,
      opened_by: user.id,
      status: 'open',
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ order });
}
