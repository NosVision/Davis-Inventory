// ระบบสต๊อกใหม่ (inv_) — types ตรงกับ migration 00061_inventory_core.sql
// จำนวน = number (PostgREST คืน numeric เป็น JSON number) ; เงินต้นทุน = สตางค์ (integer)

export type InvKind = 'drink' | 'food' | 'other';
export type InvMovementReason =
  | 'opening'
  | 'po_receive'
  | 'requisition_out'
  | 'requisition_in'
  | 'sale'
  | 'count_adjust'
  | 'waste'
  | 'transfer'
  | 'manual';
export type InvReqStatus = 'draft' | 'submitted' | 'approved' | 'fulfilled' | 'cancelled' | 'rejected';
export type InvPoStatus = 'draft' | 'submitted' | 'partial' | 'received' | 'cancelled';

export interface InvProduct {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string | null;
  kind: InvKind;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface InvStoreProduct {
  id: string;
  store_id: string;
  product_id: string;
  store_sku: string | null;
  store_name: string | null;
  active: boolean;
  created_at: string;
}

export interface InvStockMovement {
  id: string;
  store_id: string;
  product_id: string;
  qty: number;
  reason: InvMovementReason;
  ref_type: string | null;
  ref_id: string | null;
  unit_cost_satang: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface InvStockBalance {
  store_id: string;
  product_id: string;
  qty: number;
}

export interface InvSupplier {
  id: string;
  name: string;
  phone: string | null;
  contact: string | null;
  note: string | null;
  active: boolean;
  created_at: string;
}

export interface InvRequisition {
  id: string;
  req_code: string | null;
  store_id: string;
  status: InvReqStatus;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvRequisitionItem {
  id: string;
  req_id: string;
  product_id: string;
  requested_qty: number;
  approved_qty: number | null;
  fulfilled_qty: number;
  note: string | null;
}

export interface InvPurchaseOrder {
  id: string;
  po_code: string | null;
  supplier_id: string | null;
  status: InvPoStatus;
  ordered_by: string | null;
  ordered_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvPurchaseOrderItem {
  id: string;
  po_id: string;
  product_id: string;
  qty_ordered: number;
  qty_received: number;
  unit_cost_satang: number | null;
  note: string | null;
}

export interface InvPoReceipt {
  id: string;
  po_id: string;
  received_by: string | null;
  received_at: string;
  photo_url: string | null;
  note: string | null;
  created_at: string;
}

// ── view models ──
export interface InvStoreProductRow extends InvStoreProduct {
  product?: InvProduct | null;
  balance?: number;
}
export interface InvBalanceRow extends InvStockBalance {
  product?: InvProduct | null;
}
