-- 00074_menu_item_image.sql
-- รูปสินค้า/เมนู — แสดงบนจอขาย (POS) + หน้าจัดการเมนู
-- คอลัมน์เดียว เก็บ URL รูปใน storage (public) เพิ่มแบบ additive ไม่กระทบของเดิม

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT;
