-- 00050_repair_maintenance.sql
-- Repair requests + recurring maintenance tasks (งานซ่อม / งานประจำช่าง)
-- Additive only: new enums, tables, RLS, one column on notification_preferences,
-- and an idempotent SECURITY DEFINER function to generate maintenance occurrences.

-- ===== Enums =====
DO $$ BEGIN
  CREATE TYPE repair_status AS ENUM
    ('pending','in_progress','awaiting_approval','approved','rejected','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE repair_resolution AS ENUM ('repairable','needs_purchase');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== repair_requests =====
CREATE TABLE IF NOT EXISTS repair_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT,
  location         TEXT,
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  photo_urls       TEXT[] NOT NULL DEFAULT '{}',          -- รูปก่อนซ่อม
  status           repair_status NOT NULL DEFAULT 'pending',
  resolution       repair_resolution,                     -- ช่างประเมิน: ซ่อมได้/ต้องสั่งซื้อ
  estimated_cost   NUMERIC(12,2),
  purchase_note    TEXT,
  after_photo_urls TEXT[] NOT NULL DEFAULT '{}',          -- รูปหลังซ่อม
  reported_by      UUID REFERENCES profiles(id),
  assigned_to      UUID REFERENCES profiles(id),
  completed_by     UUID REFERENCES profiles(id),
  completed_at     TIMESTAMPTZ,
  approval_status  TEXT CHECK (approval_status IN ('pending','approved','rejected')),
  approved_by      UUID REFERENCES profiles(id),
  approved_at      TIMESTAMPTZ,
  owner_note       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_repair_requests_store_status
  ON repair_requests(store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_requests_created
  ON repair_requests(created_at DESC);

-- ===== maintenance_schedules (templates created by owner) =====
CREATE TABLE IF NOT EXISTS maintenance_schedules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID REFERENCES stores(id) ON DELETE CASCADE,  -- NULL = ทุกสาขา
  title          TEXT NOT NULL,
  description    TEXT,
  interval_unit  TEXT NOT NULL DEFAULT 'month' CHECK (interval_unit IN ('day','week','month')),
  interval_count INT  NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
  start_date     DATE NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maintenance_schedules_active
  ON maintenance_schedules(active);

-- ===== maintenance_occurrences (generated instances for calendar + status) =====
CREATE TABLE IF NOT EXISTS maintenance_occurrences (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id  UUID NOT NULL REFERENCES maintenance_schedules(id) ON DELETE CASCADE,
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  due_date     DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','skipped')),
  completed_by UUID REFERENCES profiles(id),
  completed_at TIMESTAMPTZ,
  photo_urls   TEXT[] NOT NULL DEFAULT '{}',
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, store_id, due_date)
);
CREATE INDEX IF NOT EXISTS idx_maintenance_occ_store_due
  ON maintenance_occurrences(store_id, due_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_occ_schedule
  ON maintenance_occurrences(schedule_id);

-- ===== updated_at triggers (reuse existing function) =====
DO $$ BEGIN
  CREATE TRIGGER trg_repair_requests_updated_at BEFORE UPDATE ON repair_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_maintenance_schedules_updated_at BEFORE UPDATE ON maintenance_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== notification_preferences: add repair toggle =====
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS notify_repair BOOLEAN DEFAULT true;

-- ===== RLS =====
ALTER TABLE repair_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_schedules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_occurrences ENABLE ROW LEVEL SECURITY;

-- repair_requests: store members (incl. assigned technicians) + admins
DROP POLICY IF EXISTS "repair_select" ON repair_requests;
CREATE POLICY "repair_select" ON repair_requests FOR SELECT TO authenticated
  USING (store_id IN (SELECT get_user_store_ids()) OR is_admin());
DROP POLICY IF EXISTS "repair_insert" ON repair_requests;
CREATE POLICY "repair_insert" ON repair_requests FOR INSERT TO authenticated
  WITH CHECK (store_id IN (SELECT get_user_store_ids()) OR is_admin());
DROP POLICY IF EXISTS "repair_update" ON repair_requests;
CREATE POLICY "repair_update" ON repair_requests FOR UPDATE TO authenticated
  USING (store_id IN (SELECT get_user_store_ids()) OR is_admin())
  WITH CHECK (store_id IN (SELECT get_user_store_ids()) OR is_admin());
DROP POLICY IF EXISTS "repair_delete" ON repair_requests;
CREATE POLICY "repair_delete" ON repair_requests FOR DELETE TO authenticated
  USING (is_admin());

-- maintenance_schedules: read by store members / all-store schedules; manage by admin (owner)
DROP POLICY IF EXISTS "msched_select" ON maintenance_schedules;
CREATE POLICY "msched_select" ON maintenance_schedules FOR SELECT TO authenticated
  USING (is_admin() OR store_id IS NULL OR store_id IN (SELECT get_user_store_ids()));
DROP POLICY IF EXISTS "msched_manage" ON maintenance_schedules;
CREATE POLICY "msched_manage" ON maintenance_schedules FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- maintenance_occurrences: read/complete by store members; insert/delete admin (generation via RPC)
DROP POLICY IF EXISTS "mocc_select" ON maintenance_occurrences;
CREATE POLICY "mocc_select" ON maintenance_occurrences FOR SELECT TO authenticated
  USING (store_id IN (SELECT get_user_store_ids()) OR is_admin());
DROP POLICY IF EXISTS "mocc_update" ON maintenance_occurrences;
CREATE POLICY "mocc_update" ON maintenance_occurrences FOR UPDATE TO authenticated
  USING (store_id IN (SELECT get_user_store_ids()) OR is_admin())
  WITH CHECK (store_id IN (SELECT get_user_store_ids()) OR is_admin());
DROP POLICY IF EXISTS "mocc_insert" ON maintenance_occurrences;
CREATE POLICY "mocc_insert" ON maintenance_occurrences FOR INSERT TO authenticated
  WITH CHECK (is_admin());
DROP POLICY IF EXISTS "mocc_delete" ON maintenance_occurrences;
CREATE POLICY "mocc_delete" ON maintenance_occurrences FOR DELETE TO authenticated
  USING (is_admin());

-- ===== RPC: idempotently generate maintenance occurrences up to p_until =====
-- SECURITY DEFINER so any authenticated user can "top up" the calendar; the
-- UNIQUE(schedule_id, store_id, due_date) constraint makes it safe to re-run.
CREATE OR REPLACE FUNCTION generate_maintenance_occurrences(
  p_until date DEFAULT ((now() AT TIME ZONE 'Asia/Bangkok')::date + interval '3 months')
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO maintenance_occurrences (schedule_id, store_id, due_date)
  SELECT s.id, st.id, d::date
  FROM maintenance_schedules s
  JOIN stores st ON st.active AND (s.store_id IS NULL OR st.id = s.store_id)
  CROSS JOIN LATERAL generate_series(
    s.start_date::timestamp,
    p_until::timestamp,
    make_interval(
      days   => CASE s.interval_unit WHEN 'day' THEN s.interval_count
                                     WHEN 'week' THEN s.interval_count * 7
                                     ELSE 0 END,
      months => CASE s.interval_unit WHEN 'month' THEN s.interval_count
                                     ELSE 0 END
    )
  ) d
  WHERE s.active
  ON CONFLICT (schedule_id, store_id, due_date) DO NOTHING;
$$;

REVOKE EXECUTE ON FUNCTION generate_maintenance_occurrences(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION generate_maintenance_occurrences(date) TO authenticated;
