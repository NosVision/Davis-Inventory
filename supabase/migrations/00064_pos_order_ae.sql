-- 00064_pos_order_ae.sql
-- วางโครง: ผูก AE (คนพาลูกค้ามาร้าน) กับบิล POS — ยังไม่พ่วงเข้าระบบคอมเดิม
-- อนาคต (go-live, ยืนยันก่อนเสมอ): generate commission_entries จากบิล
--   type='ae_commission', subtotal_amount = pos_orders.subtotal_satang/100,
--   commission_rate 0.10, tax_rate 0.03, receipt_no = order_no, table_no = ชื่อโต๊ะ, bill_date
ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS ae_id UUID REFERENCES ae_profiles(id);
CREATE INDEX IF NOT EXISTS idx_pos_orders_ae ON pos_orders(ae_id) WHERE ae_id IS NOT NULL;
