-- 00132_commission_payment_multi_slip.sql
--
-- แนบสลิปการโอนได้มากกว่า 1 รูปต่อการทำจ่าย 1 ครั้ง
-- เหตุผล: บางครั้งจ่าย AE/พนักงานเป็นหลายรอบโอน (เช่นโอน 2-3 ครั้งจน
-- ครบยอด) จึงต้องเก็บสลิปได้หลายใบ. เดิม slip_photo_url เก็บได้ใบเดียว.
--
-- เก็บเป็น array ใหม่ slip_photo_urls; คง slip_photo_url เดิมไว้ (ชี้ใบแรก)
-- เพื่อความเข้ากันได้กับโค้ด/รายงานเดิมที่ยังอ่าน column เดี่ยว.

ALTER TABLE commission_payments
  ADD COLUMN IF NOT EXISTS slip_photo_urls text[];

-- Backfill: ย้ายสลิปใบเดี่ยวเดิมเข้า array เพื่อให้ทุกแถวอ่านแบบเดียวกัน.
UPDATE commission_payments
   SET slip_photo_urls = ARRAY[slip_photo_url]
 WHERE slip_photo_url IS NOT NULL
   AND slip_photo_urls IS NULL;
