-- 00061_inventory_core.sql
-- ระบบสต๊อกใหม่ (แยกจากของเดิม + ซ่อนจากเมนู) — ไม่แตะ products/comparisons/stock เดิม
-- โครง 4 ชั้น: ① master catalog (HQ) ② ของสาขา(ผูก master เสมอ) ③ ledger ④ เอกสาร PR/PO
-- จำนวน = NUMERIC(14,3) ; เงินต้นทุน = สตางค์ (INTEGER)
-- RLS: master/ซัพ = staff อ่าน, owner/manager/accountant เขียน ; สต๊อก/ของสาขา = scope ตามสาขา

-- ── enums ──
DO $$ BEGIN CREATE TYPE inv_kind AS ENUM ('drink','food','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE inv_movement_reason AS ENUM
  ('opening','po_receive','requisition_out','requisition_in','sale','count_adjust','waste','transfer','manual');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE inv_req_status AS ENUM ('draft','submitted','approved','fulfilled','cancelled','rejected');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE inv_po_status AS ENUM ('draft','submitted','partial','received','cancelled');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ① master catalog (HQ คุม) — เครื่องดื่ม+วัตถุดิบรวมกัน แยกด้วย kind
CREATE TABLE IF NOT EXISTS inv_products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  category   TEXT,
  unit       TEXT,
  kind       inv_kind NOT NULL DEFAULT 'other',
  active     BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ② ของที่สาขามี — ผูก master เสมอ, ตั้งชื่อ/รหัสของสาขาเองได้
CREATE TABLE IF NOT EXISTS inv_store_products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES inv_products(id) ON DELETE CASCADE,
  store_sku  TEXT,
  store_name TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_inv_store_products_store ON inv_store_products(store_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_store_products_sku
  ON inv_store_products(store_id, store_sku) WHERE store_sku IS NOT NULL;

-- ③ ledger — append only, คีย์ด้วย master product_id (ยอดผูก master ข้ามชื่อสาขา)
CREATE TABLE IF NOT EXISTS inv_stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES inv_products(id) ON DELETE CASCADE,
  qty             NUMERIC(14,3) NOT NULL,          -- + เข้า / - ออก
  reason          inv_movement_reason NOT NULL DEFAULT 'manual',
  ref_type        TEXT,                            -- 'requisition' | 'purchase_order' | 'count' | 'sale' ...
  ref_id          UUID,
  unit_cost_satang INT,
  note            TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_mov_store_product ON inv_stock_movements(store_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_ref ON inv_stock_movements(ref_type, ref_id);

-- ยอดคงเหลือ = SUM(movements) ต่อ (สาขา × สินค้า) ; security_invoker → ใช้ RLS ของ movements
CREATE OR REPLACE VIEW inv_stock_balances WITH (security_invoker = true) AS
  SELECT store_id, product_id, COALESCE(SUM(qty), 0)::NUMERIC(14,3) AS qty
  FROM inv_stock_movements
  GROUP BY store_id, product_id;

-- ④ ซัพพลายเออร์ (สำหรับ PO)
CREATE TABLE IF NOT EXISTS inv_suppliers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  phone      TEXT,
  contact    TEXT,
  note       TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ④ ใบเบิก (PR) สาขา → HQ
CREATE TABLE IF NOT EXISTS inv_requisitions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  req_code     TEXT UNIQUE,
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,  -- สาขาที่ขอเบิก
  status       inv_req_status NOT NULL DEFAULT 'draft',
  requested_by UUID REFERENCES profiles(id),
  approved_by  UUID REFERENCES profiles(id),
  approved_at  TIMESTAMPTZ,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_req_store_status ON inv_requisitions(store_id, status);

CREATE TABLE IF NOT EXISTS inv_requisition_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  req_id        UUID NOT NULL REFERENCES inv_requisitions(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES inv_products(id),
  requested_qty NUMERIC(14,3) NOT NULL CHECK (requested_qty > 0),
  approved_qty  NUMERIC(14,3),
  fulfilled_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_req_items_req ON inv_requisition_items(req_id);

-- ④ ใบสั่งซื้อ (PO) HQ → ซัพพลายเออร์
CREATE TABLE IF NOT EXISTS inv_purchase_orders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_code    TEXT UNIQUE,
  supplier_id UUID REFERENCES inv_suppliers(id),
  status     inv_po_status NOT NULL DEFAULT 'draft',
  ordered_by UUID REFERENCES profiles(id),
  ordered_at TIMESTAMPTZ,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_po_status ON inv_purchase_orders(status);

CREATE TABLE IF NOT EXISTS inv_purchase_order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id           UUID NOT NULL REFERENCES inv_purchase_orders(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES inv_products(id),
  qty_ordered     NUMERIC(14,3) NOT NULL CHECK (qty_ordered > 0),
  qty_received    NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit_cost_satang INT,
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_po_items_po ON inv_purchase_order_items(po_id);

CREATE TABLE IF NOT EXISTS inv_po_receipts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id         UUID NOT NULL REFERENCES inv_purchase_orders(id) ON DELETE CASCADE,
  received_by   UUID REFERENCES profiles(id),
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  photo_url     TEXT,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_po_receipts_po ON inv_po_receipts(po_id);

-- ── เลขเอกสารรัน (PR/PO) ──
CREATE TABLE IF NOT EXISTS inv_doc_counters (
  scope   TEXT PRIMARY KEY,
  last_no INT NOT NULL DEFAULT 0
);
CREATE OR REPLACE FUNCTION next_inv_doc_no(p_scope TEXT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no INT;
BEGIN
  INSERT INTO inv_doc_counters(scope, last_no) VALUES (p_scope, 1)
  ON CONFLICT (scope) DO UPDATE SET last_no = inv_doc_counters.last_no + 1
  RETURNING last_no INTO v_no;
  RETURN v_no;
END $$;

-- ── updated_at ──
CREATE OR REPLACE FUNCTION inv_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_inv_req_updated ON inv_requisitions;
CREATE TRIGGER trg_inv_req_updated BEFORE UPDATE ON inv_requisitions
  FOR EACH ROW EXECUTE FUNCTION inv_touch_updated_at();
DROP TRIGGER IF EXISTS trg_inv_po_updated ON inv_purchase_orders;
CREATE TRIGGER trg_inv_po_updated BEFORE UPDATE ON inv_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION inv_touch_updated_at();

-- ============================================================
-- RLS
--   staff = ตำแหน่งพนักงานทั้งหมด (ไม่ใช่ลูกค้า)
--   mgmt  = owner/manager/accountant (ฝั่งจัดการ/HQ)
--   store visible = อยู่ใน user_stores ของสาขานั้น หรือ owner
-- ============================================================
ALTER TABLE inv_products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_store_products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_stock_movements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_suppliers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_requisitions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_requisition_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_purchase_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_po_receipts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_doc_counters        ENABLE ROW LEVEL SECURITY;

-- master catalog + suppliers: staff อ่าน, mgmt เขียน
DROP POLICY IF EXISTS inv_products_read ON inv_products;
CREATE POLICY inv_products_read ON inv_products FOR SELECT
  USING (get_user_role() IS NOT NULL AND get_user_role() <> 'customer');
DROP POLICY IF EXISTS inv_products_write ON inv_products;
CREATE POLICY inv_products_write ON inv_products FOR ALL
  USING (get_user_role() IN ('owner','manager','accountant'))
  WITH CHECK (get_user_role() IN ('owner','manager','accountant'));

DROP POLICY IF EXISTS inv_suppliers_read ON inv_suppliers;
CREATE POLICY inv_suppliers_read ON inv_suppliers FOR SELECT
  USING (get_user_role() IS NOT NULL AND get_user_role() <> 'customer');
DROP POLICY IF EXISTS inv_suppliers_write ON inv_suppliers;
CREATE POLICY inv_suppliers_write ON inv_suppliers FOR ALL
  USING (get_user_role() IN ('owner','manager','accountant'))
  WITH CHECK (get_user_role() IN ('owner','manager','accountant'));

-- ของสาขา: อ่านตามสาขา, mgmt เขียน
DROP POLICY IF EXISTS inv_store_products_read ON inv_store_products;
CREATE POLICY inv_store_products_read ON inv_store_products FOR SELECT
  USING (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner');
DROP POLICY IF EXISTS inv_store_products_write ON inv_store_products;
CREATE POLICY inv_store_products_write ON inv_store_products FOR ALL
  USING (get_user_role() IN ('owner','manager','accountant'))
  WITH CHECK (get_user_role() IN ('owner','manager','accountant'));

-- ledger: อ่านตามสาขา, เพิ่มได้ตามสาขา (append-only — ไม่มี update/delete policy)
DROP POLICY IF EXISTS inv_mov_read ON inv_stock_movements;
CREATE POLICY inv_mov_read ON inv_stock_movements FOR SELECT
  USING (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner');
DROP POLICY IF EXISTS inv_mov_insert ON inv_stock_movements;
CREATE POLICY inv_mov_insert ON inv_stock_movements FOR INSERT
  WITH CHECK (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner');

-- ใบเบิก (PR): สาขาเห็น/สร้างของตัวเอง, mgmt เห็น/อนุมัติทุกใบ
DROP POLICY IF EXISTS inv_req_read ON inv_requisitions;
CREATE POLICY inv_req_read ON inv_requisitions FOR SELECT
  USING (store_id IN (SELECT get_user_store_ids()) OR get_user_role() IN ('owner','manager','accountant'));
DROP POLICY IF EXISTS inv_req_insert ON inv_requisitions;
CREATE POLICY inv_req_insert ON inv_requisitions FOR INSERT
  WITH CHECK (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner');
DROP POLICY IF EXISTS inv_req_update ON inv_requisitions;
CREATE POLICY inv_req_update ON inv_requisitions FOR UPDATE
  USING (store_id IN (SELECT get_user_store_ids()) OR get_user_role() IN ('owner','manager','accountant'))
  WITH CHECK (store_id IN (SELECT get_user_store_ids()) OR get_user_role() IN ('owner','manager','accountant'));

DROP POLICY IF EXISTS inv_req_items_rw ON inv_requisition_items;
CREATE POLICY inv_req_items_rw ON inv_requisition_items FOR ALL
  USING (EXISTS (SELECT 1 FROM inv_requisitions r WHERE r.id = inv_requisition_items.req_id
                 AND (r.store_id IN (SELECT get_user_store_ids()) OR get_user_role() IN ('owner','manager','accountant'))))
  WITH CHECK (EXISTS (SELECT 1 FROM inv_requisitions r WHERE r.id = inv_requisition_items.req_id
                 AND (r.store_id IN (SELECT get_user_store_ids()) OR get_user_role() IN ('owner','manager','accountant'))));

-- ใบสั่งซื้อ (PO) + รับของ: ฝั่ง HQ/จัดการเท่านั้น
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['inv_purchase_orders','inv_purchase_order_items','inv_po_receipts'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_mgmt', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR ALL
      USING (get_user_role() IN ('owner','manager','accountant'))
      WITH CHECK (get_user_role() IN ('owner','manager','accountant'));$p$, t || '_mgmt', t);
  END LOOP;
END $$;

-- counters: อ่าน mgmt (เขียนผ่าน next_inv_doc_no = SECURITY DEFINER)
DROP POLICY IF EXISTS inv_doc_counters_read ON inv_doc_counters;
CREATE POLICY inv_doc_counters_read ON inv_doc_counters FOR SELECT
  USING (get_user_role() IN ('owner','manager','accountant'));
