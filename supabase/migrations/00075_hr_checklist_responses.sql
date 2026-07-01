-- 00075_hr_checklist_responses.sql
-- เก็บสิ่งที่เจ้าของ "ติ๊กเลือก" จากหน้า /hr-checklist.html (นำเสนอ HR)
-- เขียน/อ่านผ่าน API route (service role) เท่านั้น — anon/authenticated ถูกบล็อกด้วย RLS ไม่มี policy

CREATE TABLE IF NOT EXISTS public.hr_checklist_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      text NOT NULL UNIQUE,          -- ไอดีต่อผู้เลือก (client สร้าง เก็บใน localStorage)
  respondent_name text,                          -- ชื่อผู้เลือก (ถ้ากรอก)
  selected_keys   text[] NOT NULL DEFAULT '{}',  -- รายชื่อฟีเจอร์ที่เลือก (อ่านง่าย)
  selected_count  integer NOT NULL DEFAULT 0,
  total_count     integer NOT NULL DEFAULT 0,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hr_checklist_responses ENABLE ROW LEVEL SECURITY;
-- ไม่มี policy → เข้าถึงได้เฉพาะ service role (ฝั่ง API) เท่านั้น
