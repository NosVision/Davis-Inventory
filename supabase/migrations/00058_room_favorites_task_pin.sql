-- 00058_room_favorites_task_pin.sql
-- ติดดาวห้อง (รายการใช้บ่อย ต่อผู้ใช้) + ปักหมุดงานในห้อง

-- ===== ติดดาวห้อง (favorite) ต่อผู้ใช้ =====
CREATE TABLE IF NOT EXISTS task_room_favorites (
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  room_id    UUID NOT NULL REFERENCES task_rooms(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, room_id)
);
ALTER TABLE task_room_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trf_all" ON task_room_favorites;
CREATE POLICY "trf_all" ON task_room_favorites FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ===== ปักหมุดงาน =====
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tasks_pinned ON tasks(room_id) WHERE is_pinned;
