-- 00066_menu_station.sql
-- สเตชันครัว/บาร์ต่อหมวดเมนู — ใช้ route ออเดอร์เข้าครัว/บาร์ (KOT, P1f)
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS station TEXT; -- 'kitchen' | 'bar' | null
