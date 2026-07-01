-- 00076_hr_checklist_shared_state.sql
-- เพิ่มที่เก็บ "รายการดัชนีที่ติ๊ก" (array) เพื่อทำ state ร่วม (sync ข้ามเครื่อง)
-- หน้า checklist ใช้ session_id คงที่ 'shared-checklist' → ทุกเครื่องอ่าน/เขียน row เดียวกัน

ALTER TABLE public.hr_checklist_responses
  ADD COLUMN IF NOT EXISTS selection_map jsonb NOT NULL DEFAULT '[]'::jsonb;
