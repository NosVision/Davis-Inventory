-- 00067_pos_menu_availability.sql
-- P1b: เปิด-ปิดเมนู (86) + โควตาต่อวัน + ความพร้อมขายเรียลไทม์
-- realtime ใช้ Postgres Changes (CDC) สำหรับโต๊ะ/สต๊อก/เมนู (Broadcast ไว้ KDS เฟส P1f)

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS available    BOOLEAN NOT NULL DEFAULT true, -- เปิดขายวันนี้ (86 = false)
  ADD COLUMN IF NOT EXISTS daily_limit  INT;                          -- จำนวนจาน/วัน (null = ไม่จำกัด)

-- เพิ่มตารางเข้า publication realtime (idempotent) — RLS ยังกรองให้เห็นเฉพาะสาขาตัวเอง
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pos_orders','pos_order_items','inv_stock_movements','menu_items'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ความพร้อมขายต่อเมนู: ขายไปแล้ววันนี้ + ทำได้อีกกี่หน่วยจากสต๊อก (ตามสูตร)
-- SECURITY INVOKER → RLS ของแต่ละตารางกรองตามสิทธิ์ผู้เรียก (เห็นเฉพาะสาขาตัวเอง)
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
      AND (o.created_at AT TIME ZONE 'Asia/Bangkok')::date = (now() AT TIME ZONE 'Asia/Bangkok')::date
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
