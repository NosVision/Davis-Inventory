import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/pos/shifts?storeId= — กะที่เปิดอยู่ของสาขา (หรือ null)
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const storeId = request.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });
  const { data } = await supabase.from('pos_shifts').select('*').eq('store_id', storeId).eq('status', 'open').maybeSingle();
  return NextResponse.json({ shift: data ?? null });
}

// POST /api/pos/shifts — เปิดกะ
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { storeId?: string; openingCashSatang?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.storeId) return NextResponse.json({ error: 'ต้องระบุสาขา' }, { status: 400 });

  const { data: existing } = await supabase.from('pos_shifts').select('id').eq('store_id', body.storeId).eq('status', 'open').maybeSingle();
  if (existing) return NextResponse.json({ error: 'มีกะที่เปิดอยู่แล้ว' }, { status: 400 });

  const { data, error } = await supabase
    .from('pos_shifts')
    .insert({
      store_id: body.storeId,
      opened_by: user.id,
      opening_cash_satang: typeof body.openingCashSatang === 'number' ? Math.max(0, Math.round(body.openingCashSatang)) : 0,
      status: 'open',
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shift: data });
}
