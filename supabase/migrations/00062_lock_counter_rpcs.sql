-- 00062_lock_counter_rpcs.sql
-- ปิดไม่ให้ anon/authenticated เรียก RPC ตัวนับ (SECURITY DEFINER) ตรง ๆ ผ่าน REST
-- ให้เรียกผ่าน service role ฝั่ง server เท่านั้น — กันการปั่นเลขบิล/เลขเอกสาร
-- (server ใช้ createServiceClient ซึ่ง bypass สิทธิ์เหล่านี้)
REVOKE EXECUTE ON FUNCTION public.next_pos_order_no(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_inv_doc_no(text)   FROM PUBLIC, anon, authenticated;
