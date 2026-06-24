-- 00053_drop_legacy_repairs.sql
-- ยุบระบบซ่อม/บำรุงเดิมสมบูรณ์: migrate maintenance ที่เหลือเข้า Task Rooms แล้ว drop ตารางเก่า + enums
-- (repair_requests ถูก backfill ไปแล้วใน 00051)

DO $$
DECLARE v_room uuid; s RECORD; v_rec uuid; v_task uuid; o RECORD;
BEGIN
  SELECT id INTO v_room FROM task_rooms WHERE key = 'repairs';
  IF v_room IS NULL THEN RETURN; END IF;
  IF to_regclass('public.maintenance_schedules') IS NULL THEN RETURN; END IF;

  FOR s IN SELECT * FROM maintenance_schedules LOOP
    INSERT INTO task_recurrences (room_id, store_id, title, detail, priority, kind, start_date, interval_count, active, created_by)
    VALUES (
      v_room, s.store_id, s.title, s.description, 'med',
      (CASE s.interval_unit
         WHEN 'month' THEN 'every_months'
         WHEN 'week'  THEN 'every_weeks'
         ELSE 'every_weeks' END)::task_recurrence_kind,
      s.start_date, GREATEST(s.interval_count, 1), s.active, s.created_by
    ) RETURNING id INTO v_rec;

    -- เก็บเฉพาะ occurrence ที่ทำเสร็จแล้ว เป็นงานเดี่ยว (recurrence_id null เพื่อเลี่ยง unique)
    FOR o IN SELECT * FROM maintenance_occurrences WHERE schedule_id = s.id AND status = 'completed' LOOP
      INSERT INTO tasks (room_id, ticket_no, store_id, title, detail, status, priority,
        assigner_id, assigned_at, due_date, is_recurring_instance, completed_by, completed_at, created_by)
      VALUES (v_room, next_task_ticket(v_room), o.store_id, s.title, s.description, 'done', 'med',
        s.created_by, o.due_date, o.due_date, true, o.completed_by, o.completed_at, s.created_by)
      RETURNING id INTO v_task;

      IF COALESCE(array_length(o.photo_urls, 1), 0) > 0 THEN
        INSERT INTO task_attachments (task_id, kind, url, phase, uploaded_by, created_at)
        SELECT v_task, 'image', u, 'after', o.completed_by, COALESCE(o.completed_at, o.created_at)
        FROM unnest(o.photo_urls) u WHERE u IS NOT NULL AND u <> '';
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- สร้าง occurrence อนาคตจาก recurrence ที่เพิ่ง migrate
SELECT generate_task_occurrences();

-- drop ของเก่า
DROP FUNCTION IF EXISTS generate_maintenance_occurrences(date);
DROP TABLE IF EXISTS maintenance_occurrences CASCADE;
DROP TABLE IF EXISTS maintenance_schedules CASCADE;
DROP TABLE IF EXISTS repair_requests CASCADE;
DROP TYPE IF EXISTS repair_status;
DROP TYPE IF EXISTS repair_resolution;
