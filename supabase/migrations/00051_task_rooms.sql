-- 00051_task_rooms.sql
-- Task Rooms (ห้องงาน / Task Management) — Phase 1 (MVP)
-- ระบบงานรวมศูนย์แบบ "ห้อง" (เหมือน chat_rooms) + ยุบระบบแจ้งซ่อมเข้ามาเป็นห้องระบบ "repairs"
--
-- Additive only: enums, tables, RLS (membership-based + owner-gated), one column on
-- notification_preferences, helper RPCs, auto-join trigger, and a one-time backfill of
-- repair_requests -> tasks. ตารางซ่อมเดิมคงอยู่ (เลิกเขียน) — reversible.
-- งานประจำ (recurrence) อยู่ใน Phase 3 (มี column เผื่อไว้ ยังไม่ผูก FK).

-- ============================================================
-- Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE task_status AS ENUM
    ('pending_approval','rejected','in_progress','done','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('low','med','high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_attachment_kind AS ENUM ('image','file','link');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_assignee_state AS ENUM ('pending','acknowledged','submitted','done');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- task_rooms (mirror chat_rooms)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_rooms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT UNIQUE,                         -- slug คงที่ ('repairs' = ห้องระบบ); NULL = ห้องที่ผู้ใช้สร้าง
  name          TEXT NOT NULL,
  description   TEXT,
  icon          TEXT NOT NULL DEFAULT 'clipboard-list',  -- lucide icon name
  color         TEXT NOT NULL DEFAULT 'indigo',           -- tailwind color name
  ticket_prefix TEXT NOT NULL DEFAULT 'TR',               -- prefix เลข ticket ต่อห้อง
  is_system     BOOLEAN NOT NULL DEFAULT false,           -- true = ลบไม่ได้ (ห้องซ่อม)
  is_archived   BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_rooms_active ON task_rooms(is_archived);

-- ============================================================
-- task_room_members (mirror chat_members)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_room_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id   UUID NOT NULL REFERENCES task_rooms(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','manager')),
  added_by  UUID REFERENCES profiles(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_room_members_user ON task_room_members(user_id);

-- ============================================================
-- task_room_counters + per-room ticket generator
-- ============================================================
CREATE TABLE IF NOT EXISTS task_room_counters (
  room_id UUID PRIMARY KEY REFERENCES task_rooms(id) ON DELETE CASCADE,
  last_no INT NOT NULL DEFAULT 0
);

-- ============================================================
-- tasks (แกนกลาง; รวมงานทุกห้อง + แทน repair_requests)
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id               UUID NOT NULL REFERENCES task_rooms(id) ON DELETE CASCADE,
  ticket_no             TEXT NOT NULL,
  store_id              UUID REFERENCES stores(id) ON DELETE SET NULL,  -- venue (สาขา)
  category              TEXT,                                            -- หมวด (free-text)
  title                 TEXT NOT NULL,
  detail                TEXT,
  status                task_status NOT NULL DEFAULT 'in_progress',
  priority              task_priority NOT NULL DEFAULT 'med',
  requires_approval     BOOLEAN NOT NULL DEFAULT false,
  approver_ids          UUID[] NOT NULL DEFAULT '{}',                    -- ผู้อนุมัติที่แต่งตั้ง (หลายคน/ใครก็อนุมัติได้)
  require_attachment    BOOLEAN NOT NULL DEFAULT false,                  -- ต้องแนบไฟล์ก่อนปิดงาน
  assigner_id           UUID REFERENCES profiles(id),                   -- ผู้จ่ายงาน
  assigned_at           DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Bangkok')::date,
  due_date              DATE,
  is_recurring_instance BOOLEAN NOT NULL DEFAULT false,                 -- (Phase 3)
  recurrence_id         UUID,                                           -- (Phase 3; FK เพิ่มภายหลัง)
  occurrence_date       DATE,                                           -- (Phase 3)
  approval_status       TEXT CHECK (approval_status IN ('pending','approved','rejected')),
  approved_by           UUID REFERENCES profiles(id),                   -- คนอนุมัติจริง
  approved_at           TIMESTAMPTZ,
  owner_note            TEXT,
  completed_by          UUID REFERENCES profiles(id),
  completed_at          TIMESTAMPTZ,
  estimated_cost        NUMERIC(12,2),                                  -- ห้องซ่อม (ห้องอื่น null)
  meta                  JSONB,                                          -- ฟิลด์เฉพาะห้อง (เช่น resolution/purchase_note)
  created_by            UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, ticket_no)
);
CREATE INDEX IF NOT EXISTS idx_tasks_room_status ON tasks(room_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_room_due    ON tasks(room_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_store       ON tasks(store_id) WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_approvers   ON tasks USING GIN (approver_ids);  -- กล่องอนุมัติ

-- ============================================================
-- task_assignees (ผู้รับผิดชอบ + ติดตามรายคน)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_assignees (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  state        task_assignee_state NOT NULL DEFAULT 'pending',
  submitted_at TIMESTAMPTZ,
  note         TEXT,
  UNIQUE (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id, state);

-- ============================================================
-- task_attachments (รูป/ไฟล์/ลิงก์ — ไม่บังคับ)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind        task_attachment_kind NOT NULL,
  url         TEXT NOT NULL,
  name        TEXT,
  phase       TEXT NOT NULL DEFAULT 'work' CHECK (phase IN ('before','after','work')),
  uploaded_by UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);

-- ============================================================
-- updated_at triggers (reuse existing function)
-- ============================================================
DO $$ BEGIN
  CREATE TRIGGER trg_task_rooms_updated_at BEFORE UPDATE ON task_rooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- notification_preferences: add task toggle
-- ============================================================
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS notify_task BOOLEAN DEFAULT true;

-- ============================================================
-- Helper: รายการห้องที่ user เป็นสมาชิก (SECURITY DEFINER → กัน RLS recursion)
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_task_room_ids()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT room_id FROM task_room_members WHERE user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION get_user_task_room_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_user_task_room_ids() TO authenticated;

-- ============================================================
-- RPC: เลข ticket ต่อห้อง (serialize ด้วย UPDATE ... RETURNING)
-- ============================================================
CREATE OR REPLACE FUNCTION next_task_ticket(p_room uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no INT; v_prefix TEXT;
BEGIN
  INSERT INTO task_room_counters(room_id, last_no) VALUES (p_room, 0)
    ON CONFLICT (room_id) DO NOTHING;
  UPDATE task_room_counters SET last_no = last_no + 1
    WHERE room_id = p_room RETURNING last_no INTO v_no;
  SELECT ticket_prefix INTO v_prefix FROM task_rooms WHERE id = p_room;
  RETURN COALESCE(v_prefix, 'TR') || '-' || lpad(v_no::text, 4, '0');
END $$;
REVOKE EXECUTE ON FUNCTION next_task_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION next_task_ticket(uuid) TO authenticated;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE task_rooms         ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_room_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_room_counters ENABLE ROW LEVEL SECURITY;  -- ล็อก: เข้าได้ผ่าน RPC เท่านั้น
ALTER TABLE tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignees     ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments   ENABLE ROW LEVEL SECURITY;

-- ----- task_rooms: สมาชิกเห็นห้องตัวเอง / admin เห็นหมด; จัดการ = owner -----
DROP POLICY IF EXISTS "task_room_select" ON task_rooms;
CREATE POLICY "task_room_select" ON task_rooms FOR SELECT TO authenticated
  USING (id IN (SELECT get_user_task_room_ids()) OR is_admin());
DROP POLICY IF EXISTS "task_room_manage" ON task_rooms;
CREATE POLICY "task_room_manage" ON task_rooms FOR ALL TO authenticated
  USING (get_user_role() = 'owner') WITH CHECK (get_user_role() = 'owner');

-- ----- task_room_members: co-member เห็นกัน / admin; จัดการ = owner -----
DROP POLICY IF EXISTS "trm_select" ON task_room_members;
CREATE POLICY "trm_select" ON task_room_members FOR SELECT TO authenticated
  USING (room_id IN (SELECT get_user_task_room_ids()) OR is_admin());
DROP POLICY IF EXISTS "trm_manage" ON task_room_members;
CREATE POLICY "trm_manage" ON task_room_members FOR ALL TO authenticated
  USING (get_user_role() = 'owner') WITH CHECK (get_user_role() = 'owner');

-- ----- tasks: สมาชิกห้อง; owner override -----
DROP POLICY IF EXISTS "task_select" ON tasks;
CREATE POLICY "task_select" ON tasks FOR SELECT TO authenticated
  USING (room_id IN (SELECT get_user_task_room_ids()) OR is_admin());
DROP POLICY IF EXISTS "task_insert" ON tasks;
CREATE POLICY "task_insert" ON tasks FOR INSERT TO authenticated
  WITH CHECK (room_id IN (SELECT get_user_task_room_ids()) OR get_user_role() = 'owner');
DROP POLICY IF EXISTS "task_update" ON tasks;
CREATE POLICY "task_update" ON tasks FOR UPDATE TO authenticated
  USING (room_id IN (SELECT get_user_task_room_ids()) OR get_user_role() = 'owner')
  WITH CHECK (room_id IN (SELECT get_user_task_room_ids()) OR get_user_role() = 'owner');
DROP POLICY IF EXISTS "task_delete" ON tasks;
CREATE POLICY "task_delete" ON tasks FOR DELETE TO authenticated
  USING (get_user_role() = 'owner');

-- ----- task_assignees / task_attachments: ผูกตามสมาชิกของห้องแม่ -----
DROP POLICY IF EXISTS "task_assignee_all" ON task_assignees;
CREATE POLICY "task_assignee_all" ON task_assignees FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_assignees.task_id
                 AND (t.room_id IN (SELECT get_user_task_room_ids()) OR get_user_role() = 'owner')))
  WITH CHECK (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_assignees.task_id
                 AND (t.room_id IN (SELECT get_user_task_room_ids()) OR get_user_role() = 'owner')));

DROP POLICY IF EXISTS "task_attachment_all" ON task_attachments;
CREATE POLICY "task_attachment_all" ON task_attachments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_attachments.task_id
                 AND (t.room_id IN (SELECT get_user_task_room_ids()) OR get_user_role() = 'owner')))
  WITH CHECK (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_attachments.task_id
                 AND (t.room_id IN (SELECT get_user_task_room_ids()) OR get_user_role() = 'owner')));

-- ============================================================
-- Auto-join: เพิ่ม profile ใหม่เข้าห้องระบบทั้งหมด
-- ============================================================
CREATE OR REPLACE FUNCTION add_user_to_system_task_rooms()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IN ('owner','accountant','manager','bar','technician','staff') THEN
    INSERT INTO task_room_members (room_id, user_id, role)
    SELECT tr.id, NEW.id,
           CASE WHEN NEW.role IN ('owner','manager') THEN 'manager' ELSE 'member' END
    FROM task_rooms tr
    WHERE tr.is_system = true
    ON CONFLICT (room_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profile_add_system_task_rooms ON profiles;
CREATE TRIGGER trg_profile_add_system_task_rooms
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION add_user_to_system_task_rooms();

-- ============================================================
-- SEED: ห้องระบบ "repairs"
-- ============================================================
INSERT INTO task_rooms (key, name, description, icon, color, ticket_prefix, is_system, created_by)
SELECT 'repairs', 'แจ้งซ่อม', 'งานซ่อมบำรุงอุปกรณ์และสถานที่', 'wrench', 'rose', 'ซ่อม', true,
       (SELECT id FROM profiles WHERE role = 'owner' ORDER BY created_at LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM task_rooms WHERE key = 'repairs');

-- สมาชิกห้องซ่อม = พนักงานที่เกี่ยวข้องทั้งหมด
INSERT INTO task_room_members (room_id, user_id, role)
SELECT tr.id, p.id,
       CASE WHEN p.role IN ('owner','manager') THEN 'manager' ELSE 'member' END
FROM task_rooms tr
CROSS JOIN profiles p
WHERE tr.key = 'repairs'
  AND p.active = true
  AND p.role IN ('owner','accountant','manager','bar','technician','staff')
ON CONFLICT (room_id, user_id) DO NOTHING;

-- ============================================================
-- BACKFILL: repair_requests -> tasks (ครั้งเดียว; รันซ้ำได้)
-- ============================================================
DO $$
DECLARE v_room uuid;
BEGIN
  SELECT id INTO v_room FROM task_rooms WHERE key = 'repairs';
  IF v_room IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM tasks WHERE room_id = v_room) THEN RETURN; END IF;  -- backfill แล้ว
  IF to_regclass('public.repair_requests') IS NULL THEN RETURN; END IF;       -- ไม่มีตารางเก่า

  INSERT INTO tasks (
    id, room_id, ticket_no, store_id, category, title, detail, status, priority,
    requires_approval, assigner_id, assigned_at, approval_status, approved_by, approved_at,
    owner_note, completed_by, completed_at, estimated_cost, meta, created_by, created_at, updated_at
  )
  SELECT
    r.id, v_room,
    'ซ่อม-' || lpad((row_number() OVER (ORDER BY r.created_at))::text, 4, '0'),
    r.store_id, r.location, r.title, r.description,
    (CASE r.status
       WHEN 'awaiting_approval' THEN 'pending_approval'
       WHEN 'completed'         THEN 'done'
       WHEN 'rejected'          THEN 'rejected'
       WHEN 'cancelled'         THEN 'cancelled'
       ELSE 'in_progress'
     END)::task_status,
    (CASE r.priority WHEN 'urgent' THEN 'high' ELSE 'med' END)::task_priority,
    (r.approval_status IS NOT NULL),
    r.reported_by, r.created_at::date, r.approval_status, r.approved_by, r.approved_at,
    r.owner_note, r.completed_by, r.completed_at, r.estimated_cost,
    (CASE WHEN r.resolution IS NOT NULL OR r.purchase_note IS NOT NULL
          THEN jsonb_build_object('resolution', r.resolution, 'purchase_note', r.purchase_note)
          ELSE NULL END),
    r.reported_by, r.created_at, r.updated_at
  FROM repair_requests r;

  INSERT INTO task_room_counters (room_id, last_no)
  VALUES (v_room, (SELECT count(*) FROM repair_requests))
  ON CONFLICT (room_id) DO UPDATE SET last_no = EXCLUDED.last_no;

  INSERT INTO task_attachments (task_id, kind, url, phase, uploaded_by, created_at)
  SELECT r.id, 'image', u, 'before', r.reported_by, r.created_at
  FROM repair_requests r, unnest(r.photo_urls) AS u
  WHERE u IS NOT NULL AND u <> '';

  INSERT INTO task_attachments (task_id, kind, url, phase, uploaded_by, created_at)
  SELECT r.id, 'image', u, 'after', r.completed_by, COALESCE(r.completed_at, r.updated_at)
  FROM repair_requests r, unnest(r.after_photo_urls) AS u
  WHERE u IS NOT NULL AND u <> '';

  INSERT INTO task_assignees (task_id, user_id, state, submitted_at)
  SELECT r.id, r.assigned_to,
         (CASE WHEN r.status = 'completed' THEN 'done' ELSE 'pending' END)::task_assignee_state,
         (CASE WHEN r.status = 'completed' THEN r.completed_at ELSE NULL END)
  FROM repair_requests r
  WHERE r.assigned_to IS NOT NULL;
END $$;
