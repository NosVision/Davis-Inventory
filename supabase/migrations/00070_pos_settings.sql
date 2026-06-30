-- 00070_pos_settings.sql
-- P1d: ตั้งค่ารายสาขา — Service Charge + VAT + เวลาตัดวันทำการ
ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS service_charge_satang INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_satang INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS pos_settings (
  store_id                UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  service_rate            NUMERIC(5,4) NOT NULL DEFAULT 0,     -- 0.10 = 10%
  vat_rate                NUMERIC(5,4) NOT NULL DEFAULT 0,     -- 0.07 = 7%
  vat_inclusive           BOOLEAN NOT NULL DEFAULT false,      -- true = ราคารวม VAT แล้ว
  service_charge_taxable  BOOLEAN NOT NULL DEFAULT true,       -- VAT คิดบน (subtotal + service)
  business_day_cutoff_hour INT NOT NULL DEFAULT 6,             -- เวลาตัดวันทำการ (ชม.)
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pos_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_settings_read ON pos_settings;
CREATE POLICY pos_settings_read ON pos_settings FOR SELECT
  USING (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner');
DROP POLICY IF EXISTS pos_settings_write ON pos_settings;
CREATE POLICY pos_settings_write ON pos_settings FOR ALL
  USING (get_user_role() IN ('owner','manager')) WITH CHECK (get_user_role() IN ('owner','manager'));

-- เวลาเริ่มวันทำการของสาขา (อ่าน cutoff จาก pos_settings, ดีฟอลต์ตี 6)
CREATE OR REPLACE FUNCTION pos_business_day_start(p_store UUID)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT business_day_start_bangkok(COALESCE((SELECT business_day_cutoff_hour FROM pos_settings WHERE store_id = p_store), 6));
$$;

-- ความพร้อมขาย: ใช้ cutoff รายสาขา
CREATE OR REPLACE FUNCTION pos_menu_availability(p_store UUID)
RETURNS TABLE (menu_item_id UUID, available BOOLEAN, daily_limit INT, sold_today NUMERIC, stock_makeable NUMERIC)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH sold AS (
    SELECT oi.menu_item_id AS mid, SUM(oi.qty) AS qty
    FROM pos_order_items oi
    JOIN pos_orders o ON o.id = oi.order_id
    WHERE o.store_id = p_store
      AND o.status IN ('open','paid')
      AND NOT oi.is_void
      AND oi.menu_item_id IS NOT NULL
      AND o.created_at >= pos_business_day_start(p_store)
    GROUP BY oi.menu_item_id
  ), makeable AS (
    SELECT r.menu_item_id AS mid, MIN(FLOOR(COALESCE(b.qty,0) / NULLIF(r.qty,0))) AS makeable
    FROM pos_recipes r
    LEFT JOIN inv_stock_balances b ON b.store_id = p_store AND b.product_id = r.inv_product_id
    GROUP BY r.menu_item_id
  )
  SELECT mi.id, mi.available, mi.daily_limit,
         COALESCE(s.qty, 0)::numeric AS sold_today,
         mk.makeable::numeric AS stock_makeable
  FROM menu_items mi
  LEFT JOIN sold s ON s.mid = mi.id
  LEFT JOIN makeable mk ON mk.mid = mi.id
  WHERE mi.store_id = p_store;
$$;
