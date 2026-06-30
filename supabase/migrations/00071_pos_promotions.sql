-- 00071_pos_promotions.sql
-- P1e: โปรโมชั่น / โค้ดส่วนลด ต่อสาขา
CREATE TABLE IF NOT EXISTS pos_promotions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT,
  kind            TEXT NOT NULL DEFAULT 'percent',   -- percent | amount
  percent         INT,                                -- ถ้า percent (0-100)
  amount_satang   INT,                                -- ถ้า amount
  min_spend_satang INT NOT NULL DEFAULT 0,
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  max_uses        INT,                                -- null = ไม่จำกัด
  uses            INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, code)
);
CREATE INDEX IF NOT EXISTS idx_pos_promotions_store ON pos_promotions(store_id);

ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS promo_id UUID REFERENCES pos_promotions(id) ON DELETE SET NULL;

ALTER TABLE pos_promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_promotions_read ON pos_promotions;
CREATE POLICY pos_promotions_read ON pos_promotions FOR SELECT
  USING (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner');
DROP POLICY IF EXISTS pos_promotions_write ON pos_promotions;
CREATE POLICY pos_promotions_write ON pos_promotions FOR ALL
  USING (get_user_role() IN ('owner','manager')) WITH CHECK (get_user_role() IN ('owner','manager'));
