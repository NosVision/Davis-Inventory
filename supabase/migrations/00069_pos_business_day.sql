-- 00069_pos_business_day.sql
-- ให้ POS อิง "วันทำการ" ตี 6 เหมือนระบบเดิม (businessDateBangkok endHour=6)
-- ขายหลังเที่ยงคืนถึงตี 6 = ยังนับเป็นวันก่อน → โควตา/sold_today/รายงานต้องตัดที่ตี 6 ไม่ใช่เที่ยงคืน

-- เวลาเริ่มของ "วันทำการปัจจุบัน" (timestamptz) — ก่อนตัด p_cutoff_hour ของ Bangkok
CREATE OR REPLACE FUNCTION business_day_start_bangkok(p_cutoff_hour INT DEFAULT 6)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (
    (CASE
       WHEN (now() AT TIME ZONE 'Asia/Bangkok')::time < make_time(p_cutoff_hour, 0, 0)
       THEN (now() AT TIME ZONE 'Asia/Bangkok')::date - 1
       ELSE (now() AT TIME ZONE 'Asia/Bangkok')::date
     END)::timestamp
    + make_interval(hours => p_cutoff_hour)
  ) AT TIME ZONE 'Asia/Bangkok';
$$;

-- ความพร้อมขาย: sold_today = ขายตั้งแต่ต้นวันทำการ (ตี 6) ไม่ใช่เที่ยงคืน
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
      AND o.created_at >= business_day_start_bangkok(6)
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
