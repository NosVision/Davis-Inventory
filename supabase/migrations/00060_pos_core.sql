-- 00060_pos_core.sql
-- POS เฟส 1 (ออนไลน์ก่อน): โซน/โต๊ะ, เมนู, บิล/รายการ, การชำระเงิน
-- เงินทุกช่อง = "สตางค์" (INTEGER) ตามแนวทางใน docs/pos/PLAN.md (กัน float/ปัดเศษ)
-- RLS: scope ตามสาขาด้วย get_user_store_ids() — เจ้าของ (owner) เห็น/จัดการทุกสาขา
-- ดูแผนเต็มที่ docs/pos/PLAN.md และ guardrails ที่ src/app/(pos)/CLAUDE.md

-- ── enums ──
DO $$ BEGIN CREATE TYPE pos_order_status   AS ENUM ('open','paid','void');          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE pos_payment_method AS ENUM ('cash','promptpay','card');      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE pos_payment_status AS ENUM ('paid','pending','failed','void'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── โซน ──
CREATE TABLE IF NOT EXISTS pos_zones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort       INT NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── โต๊ะ (สถานะว่าง/ไม่ว่าง = derived จากบิลที่เปิดอยู่ ไม่เก็บในตาราง กัน state ค้าง) ──
CREATE TABLE IF NOT EXISTS pos_tables (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  zone_id    UUID REFERENCES pos_zones(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  seats      INT,
  sort       INT NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_tables_store ON pos_tables(store_id);

-- ── หมวดเมนู ──
CREATE TABLE IF NOT EXISTS menu_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort       INT NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── เมนูขาย (price_satang = ราคาขายเป็นสตางค์) product_id เผื่อ BOM/ตัดสต๊อก เฟส 2 ──
CREATE TABLE IF NOT EXISTS menu_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id  UUID REFERENCES menu_categories(id) ON DELETE SET NULL,
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  sku          TEXT,
  price_satang INT NOT NULL DEFAULT 0 CHECK (price_satang >= 0),
  sort         INT NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_menu_items_store ON menu_items(store_id, active);

-- ── บิล ──
CREATE TABLE IF NOT EXISTS pos_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  table_id        UUID REFERENCES pos_tables(id) ON DELETE SET NULL,  -- table = pointer
  order_no        INT NOT NULL,
  status          pos_order_status NOT NULL DEFAULT 'open',
  subtotal_satang INT NOT NULL DEFAULT 0,
  discount_satang INT NOT NULL DEFAULT 0,
  total_satang    INT NOT NULL DEFAULT 0,
  note            TEXT,
  opened_by       UUID REFERENCES profiles(id),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by       UUID REFERENCES profiles(id),
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, order_no)
);
CREATE INDEX IF NOT EXISTS idx_pos_orders_store_status ON pos_orders(store_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_orders_open_table   ON pos_orders(table_id) WHERE status = 'open';

-- ── รายการในบิล (snapshot ชื่อ+ราคา ณ ขณะขาย เพื่อ immutable) ──
CREATE TABLE IF NOT EXISTS pos_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
  menu_item_id      UUID REFERENCES menu_items(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  unit_price_satang INT NOT NULL DEFAULT 0,
  qty               NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (qty > 0),
  line_total_satang INT NOT NULL DEFAULT 0,
  note              TEXT,
  is_void           BOOLEAN NOT NULL DEFAULT false,
  created_by        UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_order_items_order ON pos_order_items(order_id);

-- ── การชำระเงิน (เงินสดออฟไลน์ได้; บัตร/QR ต้องมีเน็ต — เฟส 4 ผูก Beam) ──
CREATE TABLE IF NOT EXISTS pos_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
  store_id       UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  method         pos_payment_method NOT NULL DEFAULT 'cash',
  amount_satang  INT NOT NULL DEFAULT 0,
  tendered_satang INT,                 -- เงินที่รับมา (เงินสด) เพื่อคำนวณเงินทอน
  ref            TEXT,                 -- อ้างอิงธุรกรรม (Beam ฯลฯ)
  status         pos_payment_status NOT NULL DEFAULT 'paid',
  paid_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_payments_order ON pos_payments(order_id);

-- ── เลขบิลรันต่อสาขา ──
CREATE TABLE IF NOT EXISTS pos_order_counters (
  store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  last_no  INT NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_pos_order_no(p_store UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no INT;
BEGIN
  INSERT INTO pos_order_counters(store_id, last_no) VALUES (p_store, 1)
  ON CONFLICT (store_id) DO UPDATE SET last_no = pos_order_counters.last_no + 1
  RETURNING last_no INTO v_no;
  RETURN v_no;
END $$;

-- ── updated_at ──
CREATE OR REPLACE FUNCTION pos_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_pos_orders_updated ON pos_orders;
CREATE TRIGGER trg_pos_orders_updated BEFORE UPDATE ON pos_orders
  FOR EACH ROW EXECUTE FUNCTION pos_touch_updated_at();

-- ============================================================
-- RLS — เห็น/ใช้เฉพาะสาขาของตัวเอง, เจ้าของเห็นทุกสาขา
--   config (zone/table/menu): owner+manager เขียนได้ ; ขาย (order/item/payment): สมาชิกสาขาเขียนได้
-- ============================================================
ALTER TABLE pos_zones          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_tables         ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_order_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_order_counters ENABLE ROW LEVEL SECURITY;

-- เห็นสาขา = อยู่ใน user_stores ของสาขานั้น หรือเป็นเจ้าของ
-- (ใช้ซ้ำเป็น expression ในหลาย policy)

-- config tables: zones / tables / menu_categories / menu_items
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pos_zones','pos_tables','menu_categories','menu_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_read', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT
      USING (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner');$p$, t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_write', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR ALL
      USING (get_user_role() IN ('owner','manager')
             AND (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner'))
      WITH CHECK (get_user_role() IN ('owner','manager')
             AND (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner'));$p$, t || '_write', t);
  END LOOP;
END $$;

-- sale tables ที่มี store_id ตรง ๆ: orders / payments — สมาชิกสาขาเขียนได้
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pos_orders','pos_payments'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_rw', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR ALL
      USING (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner')
      WITH CHECK (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner');$p$, t || '_rw', t);
  END LOOP;
END $$;

-- pos_order_items: scope ผ่านบิลแม่
DROP POLICY IF EXISTS pos_order_items_rw ON pos_order_items;
CREATE POLICY pos_order_items_rw ON pos_order_items FOR ALL
  USING (EXISTS (SELECT 1 FROM pos_orders o WHERE o.id = pos_order_items.order_id
                 AND (o.store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner')))
  WITH CHECK (EXISTS (SELECT 1 FROM pos_orders o WHERE o.id = pos_order_items.order_id
                 AND (o.store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner')));

-- pos_order_counters: เขียนผ่าน next_pos_order_no (SECURITY DEFINER) เท่านั้น; อ่านได้เฉพาะเจ้าของ
DROP POLICY IF EXISTS pos_order_counters_read ON pos_order_counters;
CREATE POLICY pos_order_counters_read ON pos_order_counters FOR SELECT
  USING (get_user_role() = 'owner');
