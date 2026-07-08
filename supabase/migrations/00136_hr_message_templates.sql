-- HR message templates (owner ask 2026-07-08): reusable LINE hand-off messages shown on the
-- "employee created" screen so HR can copy credentials to the new hire. Placeholders {name},
-- {username}, {password}, {loginUrl} are filled client-side. Managed only through the HR-gated API
-- (service role), so RLS is enabled with no permissive policy — direct client access is denied.
CREATE TABLE IF NOT EXISTS hr_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  body text NOT NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hr_message_templates ENABLE ROW LEVEL SECURITY;

-- Seed one default template so there is something to copy on day one.
INSERT INTO hr_message_templates (name, body)
SELECT 'ค่าเริ่มต้น',
  E'สวัสดีค่ะ {name}\nบัญชีเข้าใช้งานระบบพร้อมแล้ว\n\nผู้ใช้: {username}\nรหัสผ่าน: {password}\nเข้าสู่ระบบ: {loginUrl}\n\nกรุณาเปลี่ยนรหัสผ่านหลังเข้าใช้งานครั้งแรกนะคะ'
WHERE NOT EXISTS (SELECT 1 FROM hr_message_templates);
