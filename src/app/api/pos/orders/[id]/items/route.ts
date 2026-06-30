import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { recomputeOrderTotals } from '@/lib/pos/orders';
import { lineTotalSatang } from '@/lib/pos/money';

interface AddItemBody {
  menuItemId?: string;
  qty?: number;
  note?: string;
  optionIds?: string[];
}

// POST /api/pos/orders/[id]/items — เพิ่มรายการเข้าบิล (snapshot ชื่อ+ราคา ณ ขณะขาย)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: AddItemBody;
  try {
    body = (await request.json()) as AddItemBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.menuItemId) return NextResponse.json({ error: 'ต้องระบุเมนู' }, { status: 400 });

  const { data: order } = await supabase
    .from('pos_orders')
    .select('store_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: 'ไม่พบบิล' }, { status: 404 });
  if ((order as { status: string }).status !== 'open') {
    return NextResponse.json({ error: 'บิลปิดแล้ว แก้ไขไม่ได้' }, { status: 400 });
  }

  const { data: mi } = await supabase
    .from('menu_items')
    .select('name, price_satang, store_id')
    .eq('id', body.menuItemId)
    .maybeSingle();
  const menu = mi as { name: string; price_satang: number; store_id: string } | null;
  if (!menu || menu.store_id !== (order as { store_id: string }).store_id) {
    return NextResponse.json({ error: 'เมนูไม่ถูกต้องสำหรับสาขานี้' }, { status: 400 });
  }

  const qty = body.qty && body.qty > 0 ? body.qty : 1;
  const optionIds = [...new Set((body.optionIds ?? []).filter(Boolean))];

  // ตัวเลือก (modifiers) ที่เลือก — ราคา + วัตถุดิบ
  type Opt = { id: string; name: string; price_satang: number; inv_product_id: string | null; qty: number | null };
  let modOptions: Opt[] = [];
  if (optionIds.length > 0) {
    const { data: opts } = await supabase
      .from('pos_modifier_options')
      .select('id, name, price_satang, inv_product_id, qty')
      .in('id', optionIds);
    modOptions = (opts as Opt[]) ?? [];
  }
  const modSum = modOptions.reduce((s, o) => s + o.price_satang, 0);
  const unitPrice = menu.price_satang + modSum;

  if (optionIds.length === 0) {
    // ไม่มีตัวเลือก → รวมบรรทัดเดิม (cart สะอาด 1 เมนู 1 บรรทัด)
    const { data: existingRows } = await supabase
      .from('pos_order_items')
      .select('id, qty')
      .eq('order_id', id)
      .eq('menu_item_id', body.menuItemId)
      .eq('is_void', false)
      .limit(1);
    const existing = (existingRows as { id: string; qty: number }[] | null)?.[0];
    if (existing) {
      const newQty = Number(existing.qty) + qty;
      const { error } = await supabase
        .from('pos_order_items')
        .update({ qty: newQty, line_total_satang: lineTotalSatang(menu.price_satang, newQty) })
        .eq('id', existing.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await supabase.from('pos_order_items').insert({
        order_id: id,
        menu_item_id: body.menuItemId,
        name: menu.name,
        unit_price_satang: menu.price_satang,
        qty,
        line_total_satang: lineTotalSatang(menu.price_satang, qty),
        note: body.note?.trim() || null,
        created_by: user.id,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    // มีตัวเลือก → แถวใหม่เสมอ (ราคา = ฐาน + ตัวเลือก) + snapshot ตัวเลือก
    const { data: ins, error } = await supabase
      .from('pos_order_items')
      .insert({
        order_id: id,
        menu_item_id: body.menuItemId,
        name: menu.name,
        unit_price_satang: unitPrice,
        qty,
        line_total_satang: lineTotalSatang(unitPrice, qty),
        note: body.note?.trim() || null,
        created_by: user.id,
      })
      .select('id')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await supabase.from('pos_order_item_modifiers').insert(
      modOptions.map((o) => ({
        order_item_id: (ins as { id: string }).id,
        option_id: o.id,
        name: o.name,
        price_satang: o.price_satang,
        inv_product_id: o.inv_product_id,
        qty: o.qty,
      })),
    );
  }

  const totals = await recomputeOrderTotals(id);
  const { data: items } = await supabase
    .from('pos_order_items')
    .select('*, modifiers:pos_order_item_modifiers(*)')
    .eq('order_id', id)
    .order('created_at');
  return NextResponse.json({ items: items ?? [], totals });
}
