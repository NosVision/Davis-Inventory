import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/pos/kds/done { itemIds } — ทำเสร็จ (ครัว/บาร์)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { itemIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const ids = [...new Set((body.itemIds ?? []).filter(Boolean))];
  if (ids.length === 0) return NextResponse.json({ error: 'ไม่มีรายการ' }, { status: 400 });

  const { error } = await supabase.from('pos_order_items').update({ done_at: new Date().toISOString() }).in('id', ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
