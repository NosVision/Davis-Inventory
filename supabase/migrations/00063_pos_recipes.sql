-- 00063_pos_recipes.sql
-- BOM/สูตร: เมนูขาย (menu_items) → วัตถุดิบ (inv_products) + จำนวนต่อหน่วยขาย
-- ขาย 1 หน่วยเมนู → ตัด inv_product ตาม qty ในสูตร (post inv_stock_movements reason='sale' ตอน checkout)
-- เชื่อม POS (00060) เข้ากับ ledger สต๊อกใหม่ (00061)

CREATE TABLE IF NOT EXISTS pos_recipes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id   UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  inv_product_id UUID NOT NULL REFERENCES inv_products(id) ON DELETE RESTRICT,
  qty            NUMERIC(14,4) NOT NULL CHECK (qty > 0),   -- จำนวนวัตถุดิบต่อ 1 หน่วยขาย
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (menu_item_id, inv_product_id)
);
CREATE INDEX IF NOT EXISTS idx_pos_recipes_menu ON pos_recipes(menu_item_id);

ALTER TABLE pos_recipes ENABLE ROW LEVEL SECURITY;

-- อ่าน: ตามสาขาของเมนู (หรือ owner) ; เขียน: owner/manager/accountant
DROP POLICY IF EXISTS pos_recipes_read ON pos_recipes;
CREATE POLICY pos_recipes_read ON pos_recipes FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM menu_items mi
    WHERE mi.id = pos_recipes.menu_item_id
      AND (mi.store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner')
  ));

DROP POLICY IF EXISTS pos_recipes_write ON pos_recipes;
CREATE POLICY pos_recipes_write ON pos_recipes FOR ALL
  USING (get_user_role() IN ('owner','manager','accountant'))
  WITH CHECK (get_user_role() IN ('owner','manager','accountant'));
