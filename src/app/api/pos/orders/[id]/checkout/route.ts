import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { recomputeOrderTotals } from '@/lib/pos/orders';
import type { PosPaymentMethod } from '@/types/pos';

interface CheckoutBody {
  method?: PosPaymentMethod;
  tenderedSatang?: number;
}

const METHODS: PosPaymentMethod[] = ['cash', 'promptpay', 'card'];

// POST /api/pos/orders/[id]/checkout — รับชำระเงิน + ปิดบิล
// เฟส 1: เงินสดใช้งานได้เต็ม; บัตร/QR (Beam) จะผูก gateway ในเฟส 4
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: CheckoutBody;
  try {
    body = (await request.json()) as CheckoutBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const method: PosPaymentMethod = METHODS.includes(body.method as PosPaymentMethod)
    ? (body.method as PosPaymentMethod)
    : 'cash';

  const { data: order } = await supabase
    .from('pos_orders')
    .select('id, store_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: 'ไม่พบบิล' }, { status: 404 });
  if ((order as { status: string }).status !== 'open') {
    return NextResponse.json({ error: 'บิลนี้ปิดแล้ว' }, { status: 400 });
  }

  // คำนวณยอดสดก่อนรับเงิน
  const { totalSatang } = await recomputeOrderTotals(id);

  if (method === 'cash' && typeof body.tenderedSatang === 'number' && body.tenderedSatang < totalSatang) {
    return NextResponse.json({ error: 'เงินที่รับมาน้อยกว่ายอดบิล' }, { status: 400 });
  }

  const { error: payErr } = await supabase.from('pos_payments').insert({
    order_id: id,
    store_id: (order as { store_id: string }).store_id,
    method,
    amount_satang: totalSatang,
    tendered_satang: body.tenderedSatang ?? null,
    status: 'paid',
    created_by: user.id,
  });
  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

  // ปิดบิล (กันปิดซ้ำด้วย eq status open)
  const { data: paid, error } = await supabase
    .from('pos_orders')
    .update({ status: 'paid', closed_by: user.id, closed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'open')
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const changeSatang =
    method === 'cash' && typeof body.tenderedSatang === 'number'
      ? Math.max(0, body.tenderedSatang - totalSatang)
      : 0;

  return NextResponse.json({ order: paid, totalSatang, changeSatang });
}
