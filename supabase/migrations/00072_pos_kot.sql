-- 00072_pos_kot.sql
-- P1f: ส่งครัว (KOT) — สถานะส่งครัว/บาร์ + ทำเสร็จ ต่อรายการ
ALTER TABLE pos_order_items
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,   -- ส่งครัวเมื่อไหร่ (null = ยังไม่ส่ง)
  ADD COLUMN IF NOT EXISTS station TEXT,          -- kitchen | bar (จากหมวดเมนูตอนส่ง)
  ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;   -- ครัวทำเสร็จเมื่อไหร่
CREATE INDEX IF NOT EXISTS idx_pos_order_items_kds ON pos_order_items(sent_at) WHERE sent_at IS NOT NULL AND done_at IS NULL;
