-- 00073_pos_shifts.sql
-- P1g: กะ/รอบขาย — เปิด-ปิดกะ, นับเงินสด, Z-report
CREATE TABLE IF NOT EXISTS pos_shifts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'open',  -- open | closed
  opened_by           UUID REFERENCES profiles(id),
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_cash_satang INT NOT NULL DEFAULT 0,
  closed_by           UUID REFERENCES profiles(id),
  closed_at           TIMESTAMPTZ,
  closing_cash_satang INT,                            -- เงินนับได้จริง
  expected_cash_satang INT,                           -- คาด = เงินต้น + ขายเงินสด
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- เปิดได้กะเดียวต่อสาขา
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_shifts_open ON pos_shifts(store_id) WHERE status = 'open';

ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES pos_shifts(id) ON DELETE SET NULL;

ALTER TABLE pos_shifts ENABLE ROW LEVEL SECURITY;
-- สมาชิกสาขา เปิด/ปิดกะได้ (เจ้าของเห็นทุกสาขา)
DROP POLICY IF EXISTS pos_shifts_rw ON pos_shifts;
CREATE POLICY pos_shifts_rw ON pos_shifts FOR ALL
  USING (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner')
  WITH CHECK (store_id IN (SELECT get_user_store_ids()) OR get_user_role() = 'owner');
