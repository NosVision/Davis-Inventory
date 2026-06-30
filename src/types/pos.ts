// POS เฟส 1 — types ตรงกับ migration 00060_pos_core.sql
// เงินทุกช่องเป็น "สตางค์" (integer) — แปลงเป็นบาทตอนแสดงผลเท่านั้น

export type PosOrderStatus = 'open' | 'paid' | 'void';
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
  total_satang: number;
  note: string | null;
  ae_id: string | null;
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
  created_by: string | null;
  created_at: string;
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
