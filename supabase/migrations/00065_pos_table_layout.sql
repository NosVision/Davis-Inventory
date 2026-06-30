-- 00065_pos_table_layout.sql
-- ผังโต๊ะแบบวิชวล: ตำแหน่ง x/y (เปอร์เซ็นต์ 0-100 ของผืนผัง) + รูปทรง
-- "ชั้น/โซน" = pos_zones (แต่ละ zone คือ 1 ผัง/แท็บ เช่น ชั้น 1, ชั้น 2, ระเบียง)
ALTER TABLE pos_tables
  ADD COLUMN IF NOT EXISTS pos_x NUMERIC,                       -- 0-100 % แนวนอน (null = ยังไม่วาง)
  ADD COLUMN IF NOT EXISTS pos_y NUMERIC,                       -- 0-100 % แนวตั้ง
  ADD COLUMN IF NOT EXISTS shape TEXT NOT NULL DEFAULT 'square'; -- square | circle | rect
