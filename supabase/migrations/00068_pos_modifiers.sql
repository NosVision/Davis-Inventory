-- 00068_pos_modifiers.sql
-- P1c: ตัวเลือกเมนู (modifiers) — เผ็ดน้อย/ไม่ใส่ผัก/+ไข่ดาว(+ราคา) ผูกต่อหมวด/เมนู
-- option ผูก inv_product ได้ → ตัดสต๊อกตอนขาย (เช่น +ไข่ดาว ตัดไข่)

CREATE TABLE IF NOT EXISTS pos_modifier_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  min_select INT NOT NULL DEFAULT 0,
  max_select INT NOT NULL DEFAULT 1,           -- 1 = เลือกได้อันเดียว, >1 = หลายอัน
  required   BOOLEAN NOT NULL DEFAULT false,
  sort       INT NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_mod_groups_store ON pos_modifier_groups(store_id);

CREATE TABLE IF NOT EXISTS pos_modifier_options (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES pos_modifier_groups(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  price_satang   INT NOT NULL DEFAULT 0,
  inv_product_id UUID REFERENCES inv_products(id) ON DELETE SET NULL, -- วัตถุดิบที่ตัด (ถ้ามี)
  qty            NUMERIC(14,4),                                       -- จำนวนต่อ option
  sort           INT NOT NULL DEFAULT 0,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_mod_options_group ON pos_modifier_options(group_id);

CREATE TABLE IF NOT EXISTS pos_menu_item_modifiers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  group_id     UUID NOT NULL REFERENCES pos_modifier_groups(id) ON DELETE CASCADE,
  sort         INT NOT NULL DEFAULT 0,
  UNIQUE (menu_item_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_pos_menu_item_mod_item ON pos_menu_item_modifiers(menu_item_id);

CREATE TABLE IF NOT EXISTS pos_order_item_modifiers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id  UUID NOT NULL REFERENCES pos_order_items(id) ON DELETE CASCADE,
  option_id      UUID REFERENCES pos_modifier_options(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,            -- snapshot
  price_satang   INT NOT NULL DEFAULT 0,   -- snapshot
  inv_product_id UUID,                     -- snapshot สำหรับตัดสต๊อก
  qty            NUMERIC(14,4),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_order_item_mod_item ON pos_order_item_modifiers(order_item_id);

-- ── RLS ──
ALTER TABLE pos_modifier_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_modifier_options     ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_menu_item_modifiers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_order_item_modifiers ENABLE ROW LEVEL SECURITY;

-- groups: อ่านตามสาขา, เขียน owner/manager
DROP POLICY IF EXISTS pos_mod_groups_read ON pos_modifier_groups;
CREATE POLICY pos_mod_groups_read ON pos_modifier_groups FOR SELECT
  USING (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner');
DROP POLICY IF EXISTS pos_mod_groups_write ON pos_modifier_groups;
CREATE POLICY pos_mod_groups_write ON pos_modifier_groups FOR ALL
  USING (get_user_role() IN ('owner','manager')) WITH CHECK (get_user_role() IN ('owner','manager'));

-- options: ผ่านกลุ่ม
DROP POLICY IF EXISTS pos_mod_options_read ON pos_modifier_options;
CREATE POLICY pos_mod_options_read ON pos_modifier_options FOR SELECT
  USING (EXISTS (SELECT 1 FROM pos_modifier_groups g WHERE g.id = pos_modifier_options.group_id
                 AND (g.store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner')));
DROP POLICY IF EXISTS pos_mod_options_write ON pos_modifier_options;
CREATE POLICY pos_mod_options_write ON pos_modifier_options FOR ALL
  USING (get_user_role() IN ('owner','manager')) WITH CHECK (get_user_role() IN ('owner','manager'));

-- menu_item_modifiers: ผ่านเมนู
DROP POLICY IF EXISTS pos_menu_item_mod_read ON pos_menu_item_modifiers;
CREATE POLICY pos_menu_item_mod_read ON pos_menu_item_modifiers FOR SELECT
  USING (EXISTS (SELECT 1 FROM menu_items mi WHERE mi.id = pos_menu_item_modifiers.menu_item_id
                 AND (mi.store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner')));
DROP POLICY IF EXISTS pos_menu_item_mod_write ON pos_menu_item_modifiers;
CREATE POLICY pos_menu_item_mod_write ON pos_menu_item_modifiers FOR ALL
  USING (get_user_role() IN ('owner','manager')) WITH CHECK (get_user_role() IN ('owner','manager'));

-- order_item_modifiers: ผ่านบิล (สมาชิกสาขาเขียนได้)
DROP POLICY IF EXISTS pos_order_item_mod_rw ON pos_order_item_modifiers;
CREATE POLICY pos_order_item_mod_rw ON pos_order_item_modifiers FOR ALL
  USING (EXISTS (SELECT 1 FROM pos_order_items oi JOIN pos_orders o ON o.id = oi.order_id
                 WHERE oi.id = pos_order_item_modifiers.order_item_id
                 AND (o.store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner')))
  WITH CHECK (EXISTS (SELECT 1 FROM pos_order_items oi JOIN pos_orders o ON o.id = oi.order_id
                 WHERE oi.id = pos_order_item_modifiers.order_item_id
                 AND (o.store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner')));
