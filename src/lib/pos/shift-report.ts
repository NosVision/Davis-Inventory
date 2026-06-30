import { createClient } from '@/lib/supabase/server';

export interface ShiftReport {
  bills: number;
  salesSatang: number;
  cashSatang: number;
  promptpaySatang: number;
  cardSatang: number;
  discountSatang: number;
  serviceSatang: number;
  vatSatang: number;
}

// สรุปยอดขายของกะ (เฉพาะบิลที่จ่ายแล้วใน shift นั้น)
export async function computeShiftSales(shiftId: string): Promise<ShiftReport> {
  const supabase = await createClient();
  const { data: orderRows } = await supabase
    .from('pos_orders')
    .select('id, total_satang, discount_satang, service_charge_satang, vat_satang')
    .eq('shift_id', shiftId)
    .eq('status', 'paid');
  const orders = (orderRows as { id: string; total_satang: number; discount_satang: number; service_charge_satang: number; vat_satang: number }[]) ?? [];

  const byMethod: Record<string, number> = { cash: 0, promptpay: 0, card: 0 };
  if (orders.length > 0) {
    const { data: pays } = await supabase
      .from('pos_payments')
      .select('method, amount_satang')
      .in('order_id', orders.map((o) => o.id));
    for (const p of (pays as { method: string; amount_satang: number }[]) ?? []) {
      byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount_satang;
    }
  }

  return {
    bills: orders.length,
    salesSatang: orders.reduce((s, o) => s + o.total_satang, 0),
    cashSatang: byMethod.cash,
    promptpaySatang: byMethod.promptpay,
    cardSatang: byMethod.card,
    discountSatang: orders.reduce((s, o) => s + o.discount_satang, 0),
    serviceSatang: orders.reduce((s, o) => s + o.service_charge_satang, 0),
    vatSatang: orders.reduce((s, o) => s + o.vat_satang, 0),
  };
}
