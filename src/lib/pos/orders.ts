import { createClient } from '@/lib/supabase/server';

export interface OrderTotals {
  subtotalSatang: number;
  serviceSatang: number;
  vatSatang: number;
  totalSatang: number;
}

/**
 * คำนวณยอดบิลใหม่ — รวม Service Charge + VAT ตาม pos_settings ของสาขา
 *   base    = subtotal − discount
 *   service = base × service_rate
 *   vatBase = service_charge_taxable ? base+service : base
 *   exclusive: vat = vatBase × vat_rate ; total = base+service+vat
 *   inclusive: total = base+service ; vat = ส่วน VAT ที่อยู่ในราคาแล้ว (เพื่อแสดง)
 */
export async function recomputeOrderTotals(orderId: string): Promise<OrderTotals> {
  const supabase = await createClient();
  const [{ data: order }, { data: items }] = await Promise.all([
    supabase.from('pos_orders').select('store_id, discount_satang').eq('id', orderId).single(),
    supabase.from('pos_order_items').select('line_total_satang, is_void').eq('order_id', orderId),
  ]);

  const rows = (items ?? []) as { line_total_satang: number; is_void: boolean }[];
  const subtotal = rows.filter((i) => !i.is_void).reduce((s, i) => s + i.line_total_satang, 0);
  const o = order as { store_id: string; discount_satang?: number } | null;
  const discount = o?.discount_satang ?? 0;
  const base = Math.max(0, subtotal - discount);

  let svcRate = 0;
  let vatRate = 0;
  let vatInclusive = false;
  let svcTaxable = true;
  if (o?.store_id) {
    const { data: settings } = await supabase.from('pos_settings').select('*').eq('store_id', o.store_id).maybeSingle();
    const s = settings as
      | { service_rate?: number; vat_rate?: number; vat_inclusive?: boolean; service_charge_taxable?: boolean }
      | null;
    if (s) {
      svcRate = Number(s.service_rate ?? 0);
      vatRate = Number(s.vat_rate ?? 0);
      vatInclusive = !!s.vat_inclusive;
      svcTaxable = s.service_charge_taxable ?? true;
    }
  }

  const service = Math.round(base * svcRate);
  const vatBase = svcTaxable ? base + service : base;
  let vat = 0;
  let total = 0;
  if (vatInclusive) {
    total = base + service;
    vat = vatRate > 0 ? Math.round((vatBase * vatRate) / (1 + vatRate)) : 0;
  } else {
    vat = Math.round(vatBase * vatRate);
    total = base + service + vat;
  }

  await supabase
    .from('pos_orders')
    .update({ subtotal_satang: subtotal, service_charge_satang: service, vat_satang: vat, total_satang: total })
    .eq('id', orderId);

  return { subtotalSatang: subtotal, serviceSatang: service, vatSatang: vat, totalSatang: total };
}
