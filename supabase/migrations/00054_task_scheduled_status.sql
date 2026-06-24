-- 00054_task_scheduled_status.sql
-- เพิ่มสถานะ 'scheduled' (รอเริ่ม) ให้ task_status
-- ต้องแยกเป็น migration เดี่ยว เพราะค่า enum ใหม่ต้อง commit ก่อนนำไปใช้ใน migration ถัดไป
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'scheduled';
