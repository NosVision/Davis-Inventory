-- 00052_task_recurrences.sql — Task Rooms Phase 3 (งานประจำ)
-- task_recurrences (แม่แบบงานประจำ) + FK tasks.recurrence_id + RPC generate_task_occurrences

DO $$ BEGIN
  CREATE TYPE task_recurrence_kind AS ENUM ('once','day_of_month','every_weeks','every_months');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS task_recurrences (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id              UUID NOT NULL REFERENCES task_rooms(id) ON DELETE CASCADE,
  store_id             UUID REFERENCES stores(id) ON DELETE SET NULL,  -- NULL = ทุกสาขา/ไม่ระบุ
  title                TEXT NOT NULL,
  detail               TEXT,
  category             TEXT,
  priority             task_priority NOT NULL DEFAULT 'med',
  requires_approval    BOOLEAN NOT NULL DEFAULT false,
  require_attachment   BOOLEAN NOT NULL DEFAULT false,
  approver_ids         UUID[] NOT NULL DEFAULT '{}',
  default_assignee_ids UUID[] NOT NULL DEFAULT '{}',
  kind                 task_recurrence_kind NOT NULL,
  start_date           DATE NOT NULL,
  day_of_month         INT CHECK (day_of_month BETWEEN 1 AND 31),
  interval_count       INT NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
  remind_every_days    INT,
  active               BOOLEAN NOT NULL DEFAULT true,
  created_by           UUID REFERENCES profiles(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_recurrences_room ON task_recurrences(room_id, active);

-- FK from tasks.recurrence_id (column created in 00051)
DO $$ BEGIN
  ALTER TABLE tasks
    ADD CONSTRAINT tasks_recurrence_id_fkey
    FOREIGN KEY (recurrence_id) REFERENCES task_recurrences(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_recurrence_occ
  ON tasks(recurrence_id, occurrence_date) WHERE recurrence_id IS NOT NULL;

DO $$ BEGIN
  CREATE TRIGGER trg_task_recurrences_updated_at BEFORE UPDATE ON task_recurrences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE task_recurrences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trec_select" ON task_recurrences;
CREATE POLICY "trec_select" ON task_recurrences FOR SELECT TO authenticated
  USING (room_id IN (SELECT get_user_task_room_ids()) OR is_admin());
DROP POLICY IF EXISTS "trec_manage" ON task_recurrences;
CREATE POLICY "trec_manage" ON task_recurrences FOR ALL TO authenticated
  USING (get_user_role() = 'owner') WITH CHECK (get_user_role() = 'owner');

-- RPC: generate task occurrences up to p_until (idempotent)
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
          ELSE make_interval(years => 100)   -- 'once' → start_date only
        END
      ) gs
    LOOP
      IF rec.kind = 'day_of_month' AND rec.day_of_month IS NOT NULL THEN
        v_dom := LEAST(
          rec.day_of_month,
          EXTRACT(DAY FROM (date_trunc('month', d) + interval '1 month - 1 day'))::int
        );
        d := (date_trunc('month', d)::date) + (v_dom - 1);
      END IF;

      IF d < rec.start_date OR d > p_until THEN CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM tasks WHERE recurrence_id = rec.id AND occurrence_date = d) THEN
        CONTINUE;
      END IF;

      BEGIN
        INSERT INTO tasks (
          room_id, ticket_no, store_id, category, title, detail, status, priority,
          requires_approval, approver_ids, require_attachment, assigner_id, assigned_at, due_date,
          is_recurring_instance, recurrence_id, occurrence_date, created_by
        ) VALUES (
          rec.room_id, next_task_ticket(rec.room_id), rec.store_id, rec.category, rec.title, rec.detail,
          'in_progress', rec.priority, rec.requires_approval, rec.approver_ids, rec.require_attachment,
          rec.created_by, d, d, true, rec.id, d, rec.created_by
        ) RETURNING id INTO v_task_id;

        IF COALESCE(array_length(rec.default_assignee_ids, 1), 0) > 0 THEN
          INSERT INTO task_assignees (task_id, user_id)
          SELECT v_task_id, unnest(rec.default_assignee_ids)
          ON CONFLICT DO NOTHING;
        END IF;

        v_count := v_count + 1;
      EXCEPTION WHEN unique_violation THEN
        NULL;  -- generated concurrently; skip
      END;
    END LOOP;
  END LOOP;
  RETURN v_count;
END $$;

REVOKE EXECUTE ON FUNCTION generate_task_occurrences(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION generate_task_occurrences(date) TO authenticated;
