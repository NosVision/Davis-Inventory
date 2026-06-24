-- 00055_task_start_date.sql
-- งานที่ "ยังไม่ถึงวันเริ่ม" → สถานะ scheduled + ฟิลด์ start_date
-- generate_task_occurrences ตั้ง scheduled ให้รอบที่ยังไม่ถึงวัน; backfill ของเดิม

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE;
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(start_date) WHERE status = 'scheduled';

CREATE OR REPLACE FUNCTION generate_task_occurrences(
  p_until date DEFAULT ((now() AT TIME ZONE 'Asia/Bangkok')::date + interval '3 months')
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec RECORD;
  d date;
  v_task_id uuid;
  v_count int := 0;
  v_dom int;
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
BEGIN
  FOR rec IN SELECT * FROM task_recurrences WHERE active LOOP
    FOR d IN
      SELECT gs::date FROM generate_series(
        rec.start_date::timestamp,
        p_until::timestamp,
        CASE rec.kind
          WHEN 'every_weeks'  THEN make_interval(days => GREATEST(rec.interval_count, 1) * 7)
          WHEN 'every_months' THEN make_interval(months => GREATEST(rec.interval_count, 1))
          WHEN 'day_of_month' THEN make_interval(months => 1)
          ELSE make_interval(years => 100)
        END
      ) gs
    LOOP
      IF rec.kind = 'day_of_month' AND rec.day_of_month IS NOT NULL THEN
        v_dom := LEAST(rec.day_of_month, EXTRACT(DAY FROM (date_trunc('month', d) + interval '1 month - 1 day'))::int);
        d := (date_trunc('month', d)::date) + (v_dom - 1);
      END IF;
      IF d < rec.start_date OR d > p_until THEN CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM tasks WHERE recurrence_id = rec.id AND occurrence_date = d) THEN CONTINUE; END IF;

      BEGIN
        INSERT INTO tasks (
          room_id, ticket_no, store_id, category, title, detail, status, priority,
          requires_approval, approver_ids, require_attachment, assigner_id, assigned_at, start_date, due_date,
          is_recurring_instance, recurrence_id, occurrence_date, created_by
        ) VALUES (
          rec.room_id, next_task_ticket(rec.room_id), rec.store_id, rec.category, rec.title, rec.detail,
          (CASE WHEN d > v_today THEN 'scheduled' ELSE 'in_progress' END)::task_status,
          rec.priority, rec.requires_approval, rec.approver_ids, rec.require_attachment,
          rec.created_by, d, d, d, true, rec.id, d, rec.created_by
        ) RETURNING id INTO v_task_id;

        IF COALESCE(array_length(rec.default_assignee_ids, 1), 0) > 0 THEN
          INSERT INTO task_assignees (task_id, user_id)
          SELECT v_task_id, unnest(rec.default_assignee_ids) ON CONFLICT DO NOTHING;
        END IF;
        v_count := v_count + 1;
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END LOOP;
  END LOOP;
  RETURN v_count;
END $$;

REVOKE EXECUTE ON FUNCTION generate_task_occurrences(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION generate_task_occurrences(date) TO authenticated;

-- ===== Backfill: งานในอนาคตที่มีอยู่ → scheduled =====
UPDATE tasks SET start_date = occurrence_date
  WHERE is_recurring_instance AND occurrence_date IS NOT NULL AND start_date IS NULL;

UPDATE tasks SET status = 'scheduled'
  WHERE status = 'in_progress'
    AND start_date IS NOT NULL
    AND start_date > (now() AT TIME ZONE 'Asia/Bangkok')::date;
