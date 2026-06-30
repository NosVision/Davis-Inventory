import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { recomputeOrderTotals } from '@/lib/pos/orders';

interface PromoRow {
  id: string;
  kind: 'percent' | 'amount';
  percent: number | null;
  amount_satang: number | null;
  min_spend_satang: number;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  uses: number;
}

// POST /api/pos/orders/[id]/promo — ใช้โค้ดโปรโมชั่นกับบิล
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const code = (body.code ?? '').trim().toUpperCase();
  if (!code) return NextResponse.json({ error: 'ใส่โค้ดโปรโมชั่น' }, { status: 400 });

  const { data: orderRow } = await supabase
    .from('pos_orders')
    .select('id, store_id, status, subtotal_satang')
    .eq('id', id)
    .maybeSingle();
  const order = orderRow as { store_id: string; status: string; subtotal_satang: number } | null;
  if (!order) return NextResponse.json({ error: 'ไม่พบบิล' }, { status: 404 });
  if (order.status !== 'open') return NextResponse.json({ error: 'บิลปิดแล้ว' }, { status: 400 });

  const { data: promoRow } = await supabase
    .from('pos_promotions')
    .select('*')
    .eq('store_id', order.store_id)
    .eq('code', code)
    .eq('active', true)
    .maybeSingle();
  const promo = promoRow as PromoRow | null;
  if (!promo) return NextResponse.json({ error: 'ไม่พบโค้ดนี้' }, { status: 404 });

  const now = new Date();
  if (promo.starts_at && new Date(promo.starts_at) > now) return NextResponse.json({ error: 'โค้ดยังไม่เริ่มใช้' }, { status: 400 });
  if (promo.ends_at && new Date(promo.ends_at) < now) return NextResponse.json({ error: 'โค้ดหมดอายุแล้ว' }, { status: 400 });
  if (promo.max_uses != null && promo.uses >= promo.max_uses) return NextResponse.json({ error: 'โค้ดถูกใช้ครบแล้ว' }, { status: 400 });
  if (order.subtotal_satang < promo.min_spend_satang) {
    return NextResponse.json({ error: `ต้องมียอดขั้นต่ำ ฿${(promo.min_spend_satang / 100).toLocaleString('th-TH')}` }, { status: 400 });
  }

  const discount =
    promo.kind === 'percent'
      ? Math.round((order.subtotal_satang * (promo.percent ?? 0)) / 100)
      : Math.min(promo.amount_satang ?? 0, order.subtotal_satang);

  await supabase.from('pos_orders').update({ discount_satang: discount, promo_id: promo.id }).eq('id', id);
  const totals = await recomputeOrderTotals(id);
  const { data: updated } = await supabase.from('pos_orders').select('*').eq('id', id).single();
  return NextResponse.json({ order: updated, totals });
}

// DELETE /api/pos/orders/[id]/promo — เอาโค้ดออก
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await supabase.from('pos_orders').update({ discount_satang: 0, promo_id: null }).eq('id', id);
  const totals = await recomputeOrderTotals(id);
  const { data: updated } = await supabase.from('pos_orders').select('*').eq('id', id).single();
  return NextResponse.json({ order: updated, totals });
}
