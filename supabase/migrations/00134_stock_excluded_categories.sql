-- 00134_stock_excluded_categories.sql
--
-- หมวดสินค้าที่ "ไม่ต้องนับสต๊อก" ต่อสาขา
-- ใช้กับตอนอัปโหลด POS: สินค้าในหมวดเหล่านี้จะถูกข้าม —
--   ไม่ auto-add เข้า products, ไม่บันทึกเป็นรายการนับ (ocr_items)
-- เหตุผล: วัตถุดิบของสด/ของแห้ง (Meat, Seafood, Vegetable, Dried Raw
--   Materials ฯลฯ) ยังไม่ต้องการนับสต๊อก จึงไม่ควรถูกเพิ่มเข้าฐานข้อมูล

CREATE TABLE IF NOT EXISTS stock_excluded_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category    text NOT NULL,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, category)
);

CREATE INDEX IF NOT EXISTS idx_stock_excluded_categories_store
  ON stock_excluded_categories(store_id);

ALTER TABLE stock_excluded_categories ENABLE ROW LEVEL SECURITY;

-- ดู/แก้ได้เฉพาะสมาชิกของสาขา (owner/accountant ดูทุกสาขาผ่าน is_admin)
DO $$ BEGIN
  CREATE POLICY "stock_excluded_categories_select" ON stock_excluded_categories
    FOR SELECT TO authenticated
    USING (store_id IN (SELECT get_user_store_ids()) OR is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "stock_excluded_categories_insert" ON stock_excluded_categories
    FOR INSERT TO authenticated
    WITH CHECK (store_id IN (SELECT get_user_store_ids()) OR is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "stock_excluded_categories_delete" ON stock_excluded_categories
    FOR DELETE TO authenticated
    USING (store_id IN (SELECT get_user_store_ids()) OR is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
