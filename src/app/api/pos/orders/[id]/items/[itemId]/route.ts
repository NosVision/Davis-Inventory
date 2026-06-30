import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { recomputeOrderTotals } from '@/lib/pos/orders';

// DELETE /api/pos/orders/[id]/items/[itemId] — ลบรายการออกจากบิล (เฉพาะบิลที่ยังเปิด)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: order } = await supabase.from('pos_orders').select('status').eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'ไม่พบบิล' }, { status: 404 });
  if ((order as { status: string }).status !== 'open') {
    return NextResponse.json({ error: 'บิลปิดแล้ว แก้ไขไม่ได้' }, { status: 400 });
  }

  const { error } = await supabase.from('pos_order_items').delete().eq('id', itemId).eq('order_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const totals = await recomputeOrderTotals(id);
  const { data: items } = await supabase
    .from('pos_order_items')
    .select('*')
    .eq('order_id', id)
    .order('created_at');
  return NextResponse.json({ items: items ?? [], totals });
}
