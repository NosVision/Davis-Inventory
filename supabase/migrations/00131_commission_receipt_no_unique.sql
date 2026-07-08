-- 00131_commission_receipt_no_unique.sql
--
-- กันใส่บิลซ้ำ: เลขที่บิล (receipt_no) ห้ามซ้ำ "ต่อสาขา"
-- สำหรับรายการที่ยังใช้งานอยู่ (ยังไม่ถูกยกเลิก).
--
-- เหตุผล: ก่อนหน้านี้ receipt_no เป็นแค่ text ไม่มี constraint ทำให้
-- invoice เดียวกันถูกบันทึกซ้ำในสาขาเดียวกันได้ → จ่ายคอมมิชชั่นซ้ำ.
--
-- ขอบเขต = ต่อสาขา (store_id, receipt_no) ไม่ใช่ทั้งระบบ:
--   จากข้อมูลจริง เลขบิลซ้ำ "ข้ามสาขา" เป็นเรื่องปกติ — แต่ละสาขาออก
--   เลขใบเสร็จของตัวเอง จึงชนกันได้โดยเป็นคนละบิลจริง ๆ
--   (เช่น Rc6906240112 อยู่ทั้งสาขา 7242… และ b165… คนละยอด คนละ AE).
--   การกันแบบต่อสาขาจึงจับ "ใส่บิลเดิมซ้ำในสาขาเดียว" ได้ตรงจุด โดย
--   ไม่บล็อกบิลคนละสาขาที่บังเอิญเลขตรงกัน.
--
-- นับเฉพาะ active → WHERE cancelled_at IS NULL
--   (บิลที่ยกเลิกแล้ว ปล่อยให้เลขเดิมนำกลับมาใช้ได้ กรณีบันทึกผิด).
-- receipt_no ที่เป็น NULL ไม่ถูกบังคับ (bottle commission มักไม่มีเลขบิล).

CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_entries_receipt_no_active
  ON commission_entries (store_id, receipt_no)
  WHERE receipt_no IS NOT NULL AND cancelled_at IS NULL;
