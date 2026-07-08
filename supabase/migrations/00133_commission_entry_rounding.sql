-- 00133_commission_entry_rounding.sql
--
-- ตัวเลือกปัดเศษยอดสุทธิตอนบันทึกบิล: ปัดขึ้น (up) หรือ ปัดลง (down).
-- ค่าเริ่มต้นของระบบคือ "ปัดขึ้น".
--
-- เก็บโหมดที่เลือกไว้เพื่อการตรวจสอบย้อนหลัง. net_amount ที่บันทึกคือ
-- ยอดที่ปัดเศษแล้ว (ปัดเป็นจำนวนเต็มบาท).
--
-- Nullable โดยตั้งใจ: 542 แถวเดิมที่คำนวณด้วยวิธีเก่า (ปัด 2 ตำแหน่ง)
-- จะเป็น NULL = ไม่ระบุ/legacy ไม่ถูกตีความว่าปัดขึ้น. รายการใหม่จะส่ง
-- 'up'/'down' เสมอ (ดีฟอลต์ 'up' ที่ฝั่ง API).

ALTER TABLE commission_entries
  ADD COLUMN IF NOT EXISTS rounding text;

DO $$ BEGIN
  ALTER TABLE commission_entries
    ADD CONSTRAINT commission_entries_rounding_check
    CHECK (rounding IS NULL OR rounding IN ('up', 'down'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
