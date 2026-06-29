-- 00059_task_room_config.sql
-- คอนฟิกความยืดหยุ่นต่อ "ห้องงาน" (= ประเภทที่เจ้าของตั้งเอง ไม่ hardcode)
-- รองรับงานหลายทิศ: เจ้าของ→พนักงาน (manual), แจ้งซ่อม→ช่าง (claim), พนักงาน↔พนักงาน
--   assign_mode             : วิธีมอบหมายเมื่อมีงานเข้าห้อง
--   responsible_target       : กลุ่มผู้รับผิดชอบ (ทุกคน/สาขา/ตำแหน่ง/คน)
--   creator_target           : ใครเปิดเรื่อง/สร้างงานในห้องนี้ได้
--   default_response_type    : โหมดตอบกลับเริ่มต้น (override ต่องานได้)
--   require_attachment_default

DO $$ BEGIN
  CREATE TYPE task_assign_mode AS ENUM ('manual','claim','all');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE task_rooms
  ADD COLUMN IF NOT EXISTS assign_mode                task_assign_mode   NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS default_response_type      task_response_type NOT NULL DEFAULT 'submit',
  ADD COLUMN IF NOT EXISTS responsible_target         jsonb              NOT NULL DEFAULT '{"mode":"manual"}'::jsonb,
  ADD COLUMN IF NOT EXISTS creator_target             jsonb              NOT NULL DEFAULT '{"mode":"everyone"}'::jsonb,
  ADD COLUMN IF NOT EXISTS require_attachment_default boolean            NOT NULL DEFAULT false;

COMMENT ON COLUMN task_rooms.assign_mode IS
  'manual=เจ้าของเลือกผู้รับผิดชอบเองรายงาน · claim=เตือนกลุ่มเป้าหมายทุกคน ใครรับก็ได้ · all=มอบหมายทุกคนในกลุ่ม';
COMMENT ON COLUMN task_rooms.responsible_target IS
  'กลุ่มผู้รับผิดชอบ {mode: manual|everyone|stores|roles|users, storeIds?, roles?, userIds?}';
COMMENT ON COLUMN task_rooms.creator_target IS
  'ใครเปิดเรื่อง/สร้างงานในห้องนี้ได้ {mode: everyone|stores|roles|users, storeIds?, roles?, userIds?}';
COMMENT ON COLUMN task_rooms.default_response_type IS
  'โหมดตอบกลับเริ่มต้นของงานในห้อง — override รายงานได้';
