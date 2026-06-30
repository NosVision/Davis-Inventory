// POS เฟส 1 — types ตรงกับ migration 00060_pos_core.sql
// เงินทุกช่องเป็น "สตางค์" (integer) — แปลงเป็นบาทตอนแสดงผลเท่านั้น

export type PosOrderStatus = 'open' | 'paid' | 'void';

export interface PosSettings {
  store_id: string;
  service_rate: number;
  vat_rate: number;
  vat_inclusive: boolean;
  service_charge_taxable: boolean;
  business_day_cutoff_hour: number;
  updated_at: string;
}
export type PosPaymentMethod = 'cash' | 'promptpay' | 'card';
export type PosPaymentStatus = 'paid' | 'pending' | 'failed' | 'void';

export interface PosZone {
  id: string;
  store_id: string;
  name: string;
  sort: number;
  active: boolean;
  created_at: string;
}

export interface PosTable {
  id: string;
  store_id: string;
  zone_id: string | null;
  name: string;
  seats: number | null;
  sort: number;
  active: boolean;
  pos_x: number | null;
  pos_y: number | null;
  shape: string;
  created_at: string;
}

export interface MenuCategory {
  id: string;
  store_id: string;
  name: string;
  station: string | null;
  sort: number;
  active: boolean;
  created_at: string;
}

export interface MenuItem {
  id: string;
  store_id: string;
  category_id: string | null;
  product_id: string | null;
  name: string;
  sku: string | null;
  price_satang: number;
  sort: number;
  active: boolean;
  available: boolean;
  daily_limit: number | null;
  created_at: string;
}

/** ความพร้อมขายต่อเมนู (จาก RPC pos_menu_availability) */
export interface MenuAvailability {
  menu_item_id: string;
  available: boolean;
  daily_limit: number | null;
  sold_today: number;
  stock_makeable: number | null;
}

export interface PosOrder {
  id: string;
  store_id: string;
  table_id: string | null;
  order_no: number;
  status: PosOrderStatus;
  subtotal_satang: number;
  discount_satang: number;
  service_charge_satang: number;
  vat_satang: number;
  total_satang: number;
  note: string | null;
  ae_id: string | null;
  promo_id: string | null;
  opened_by: string | null;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PosOrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name: string;
  unit_price_satang: number;
  qty: number;
  line_total_satang: number;
  note: string | null;
  is_void: boolean;
  sent_at: string | null;
  station: string | null;
  done_at: string | null;
  created_by: string | null;
  created_at: string;
  modifiers?: PosOrderItemModifier[];
}

export interface PosPayment {
  id: string;
  order_id: string;
  store_id: string;
  method: PosPaymentMethod;
  amount_satang: number;
  tendered_satang: number | null;
  ref: string | null;
  status: PosPaymentStatus;
  paid_at: string;
  created_by: string | null;
  created_at: string;
}

export interface PosModifierGroup {
  id: string;
  store_id: string;
  name: string;
  min_select: number;
  max_select: number;
  required: boolean;
  sort: number;
  active: boolean;
  created_at: string;
}

export interface PosModifierOption {
  id: string;
  group_id: string;
  name: string;
  price_satang: number;
  inv_product_id: string | null;
  qty: number | null;
  sort: number;
  active: boolean;
  created_at: string;
}

export interface ModifierGroupWithOptions extends PosModifierGroup {
  options: PosModifierOption[];
}

export interface PosPromotion {
  id: string;
  store_id: string;
  code: string;
  name: string | null;
  kind: 'percent' | 'amount';
  percent: number | null;
  amount_satang: number | null;
  min_spend_satang: number;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  uses: number;
  active: boolean;
  created_at: string;
}

export interface PosOrderItemModifier {
  id: string;
  order_item_id: string;
  option_id: string | null;
  name: string;
  price_satang: number;
  inv_product_id: string | null;
  qty: number | null;
  created_at: string;
}

// ── view models ──
export interface PosOrderWithItems extends PosOrder {
  items: PosOrderItem[];
  payments?: PosPayment[];
}

export interface PosTableWithOrder extends PosTable {
  open_order?: PosOrder | null;
}

export interface MenuItemWithCategory extends MenuItem {
  category?: MenuCategory | null;
}
