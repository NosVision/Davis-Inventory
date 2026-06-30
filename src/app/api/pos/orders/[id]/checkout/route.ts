import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
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

  // ── ตัดสต๊อกตาม BOM (post ledger reason='sale') — best-effort ไม่ให้การตัดสต๊อกล้มการขาย ──
  try {
    const svc = createServiceClient();
    const { data: itemRows } = await svc
      .from('pos_order_items')
      .select('menu_item_id, qty, is_void')
      .eq('order_id', id);
    const sold = ((itemRows as { menu_item_id: string | null; qty: number; is_void: boolean }[]) ?? []).filter(
      (i) => !i.is_void && i.menu_item_id,
    );
    const menuIds = [...new Set(sold.map((i) => i.menu_item_id as string))];
    if (menuIds.length > 0) {
      const { data: recipeRows } = await svc
        .from('pos_recipes')
        .select('menu_item_id, inv_product_id, qty')
        .in('menu_item_id', menuIds);
      const recipes = (recipeRows as { menu_item_id: string; inv_product_id: string; qty: number }[]) ?? [];
      const deduct = new Map<string, number>();
      for (const it of sold) {
        for (const r of recipes) {
          if (r.menu_item_id !== it.menu_item_id) continue;
          deduct.set(r.inv_product_id, (deduct.get(r.inv_product_id) ?? 0) + Number(it.qty) * Number(r.qty));
        }
      }
      if (deduct.size > 0) {
        const moves = [...deduct.entries()].map(([pid, q]) => ({
          store_id: (order as { store_id: string }).store_id,
          product_id: pid,
          qty: -q,
          reason: 'sale',
          ref_type: 'pos_order',
          ref_id: id,
          created_by: user.id,
        }));
        await svc.from('inv_stock_movements').insert(moves);
      }
    }
  } catch {
    // sale บันทึกแล้ว — การตัดสต๊อกล้มไม่ควรทำให้ checkout ล้ม (reconcile ภายหลังได้)
  }

  const changeSatang =
    method === 'cash' && typeof body.tenderedSatang === 'number'
      ? Math.max(0, body.tenderedSatang - totalSatang)
      : 0;

  return NextResponse.json({ order: paid, totalSatang, changeSatang });
}
