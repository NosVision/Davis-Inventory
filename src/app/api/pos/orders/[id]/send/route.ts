import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface ItemRow {
  id: string;
  is_void: boolean;
  sent_at: string | null;
  menu: { category: { station: string | null } | null } | null;
}

// POST /api/pos/orders/[id]/send — ส่งรายการที่ยังไม่ส่งเข้าครัว/บาร์ (KOT)
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: order } = await supabase.from('pos_orders').select('status, store_id').eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'ไม่พบบิล' }, { status: 404 });

  const { data: rows } = await supabase
    .from('pos_order_items')
    .select('id, is_void, sent_at, menu:menu_items(category:menu_categories(station))')
    .eq('order_id', id);
  const unsent = ((rows as unknown as ItemRow[]) ?? []).filter((i) => !i.sent_at && !i.is_void);

  if (unsent.length === 0) return NextResponse.json({ sent: 0, storeId: (order as { store_id: string }).store_id });

  const now = new Date().toISOString();
  await Promise.all(
    unsent.map((it) =>
      supabase
        .from('pos_order_items')
        .update({ sent_at: now, station: it.menu?.category?.station ?? 'kitchen' })
        .eq('id', it.id),
    ),
  );

  return NextResponse.json({ sent: unsent.length, storeId: (order as { store_id: string }).store_id });
}
