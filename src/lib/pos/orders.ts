import { createClient } from '@/lib/supabase/server';

/**
 * คำนวณยอดบิลใหม่จากรายการที่ "ยังไม่ถูกยกเลิก" แล้วอัปเดตลงบิล
 * total = subtotal - discount (ไม่ต่ำกว่า 0) — เรียกหลังเพิ่ม/ลบรายการหรือแก้ส่วนลด
 */
export async function recomputeOrderTotals(
  orderId: string,
): Promise<{ subtotalSatang: number; totalSatang: number }> {
  const supabase = await createClient();
  const [{ data: order }, { data: items }] = await Promise.all([
    supabase.from('pos_orders').select('discount_satang').eq('id', orderId).single(),
    supabase.from('pos_order_items').select('line_total_satang, is_void').eq('order_id', orderId),
  ]);

  const rows = (items ?? []) as { line_total_satang: number; is_void: boolean }[];
  const subtotal = rows.filter((i) => !i.is_void).reduce((s, i) => s + i.line_total_satang, 0);
  const discount = (order as { discount_satang?: number } | null)?.discount_satang ?? 0;
  const total = Math.max(0, subtotal - discount);

  await supabase
    .from('pos_orders')
    .update({ subtotal_satang: subtotal, total_satang: total })
    .eq('id', orderId);

  return { subtotalSatang: subtotal, totalSatang: total };
}
