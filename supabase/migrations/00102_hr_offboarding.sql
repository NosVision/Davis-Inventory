-- HR Offboarding (P3.4b, §J6) — resignation / termination workflow
-- HR initiates → resolves the employee's asset-return checklist → employee acknowledges +
-- HR signs off → complete: applies hr_employees.status/end_date/end_reason, updates hr_assets,
-- deactivates the account. §118 severance is recorded as a note here; the money is P4.

CREATE TABLE IF NOT EXISTS hr_offboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,     -- the departing employee
  company_id UUID REFERENCES hr_companies(id) ON DELETE SET NULL,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('resignation', 'termination')),
  reason TEXT,
  notice_date DATE,
  last_working_date DATE,
  severance_note TEXT,                                                 -- §118 intent (money computed in P4)
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_signoff', 'completed', 'cancelled')),
  employee_signature_path TEXT,
  employee_signed_at TIMESTAMPTZ,
  hr_signature_path TEXT,
  hr_signed_at TIMESTAMPTZ,
  hr_signed_by UUID REFERENCES profiles(id),
  initiated_by UUID NOT NULL REFERENCES profiles(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

-- One in-progress offboarding per employee (draft or pending_signoff).
CREATE UNIQUE INDEX IF NOT EXISTS hr_offboarding_one_open
  ON hr_offboarding(user_id)
  WHERE status IN ('draft', 'pending_signoff');

CREATE INDEX IF NOT EXISTS hr_offboarding_status ON hr_offboarding(status, created_at DESC);
CREATE INDEX IF NOT EXISTS hr_offboarding_user ON hr_offboarding(user_id, created_at DESC);

-- Asset-return checklist: one row per asset the employee held when offboarding began.
CREATE TABLE IF NOT EXISTS hr_offboarding_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offboarding_id UUID NOT NULL REFERENCES hr_offboarding(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES hr_assets(id) ON DELETE CASCADE,
  asset_code TEXT,                                                     -- snapshot
  asset_name TEXT,                                                     -- snapshot
  resolution TEXT NOT NULL DEFAULT 'pending'
    CHECK (resolution IN ('pending', 'returned', 'lost', 'damaged')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (offboarding_id, asset_id)
);

CREATE INDEX IF NOT EXISTS hr_offboarding_assets_parent ON hr_offboarding_assets(offboarding_id);

ALTER TABLE hr_offboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_offboarding_assets ENABLE ROW LEVEL SECURITY;

-- Offboarding: the employee can read their own record (to acknowledge); HR reads/writes all.
CREATE POLICY hr_offboarding_read_policy ON hr_offboarding
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR can_manage_hr());

CREATE POLICY hr_offboarding_write_policy ON hr_offboarding
  FOR ALL TO authenticated
  USING (can_manage_hr())
  WITH CHECK (can_manage_hr());

-- Asset checklist: readable to whoever can read the parent; writable by HR.
CREATE POLICY hr_offboarding_assets_read_policy ON hr_offboarding_assets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hr_offboarding o
      WHERE o.id = hr_offboarding_assets.offboarding_id
        AND (o.user_id = auth.uid() OR can_manage_hr())
    )
  );

CREATE POLICY hr_offboarding_assets_write_policy ON hr_offboarding_assets
  FOR ALL TO authenticated
  USING (can_manage_hr())
  WITH CHECK (can_manage_hr());

CREATE OR REPLACE FUNCTION hr_offboarding_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hr_offboarding_set_updated_at ON hr_offboarding;
CREATE TRIGGER hr_offboarding_set_updated_at BEFORE UPDATE ON hr_offboarding
  FOR EACH ROW EXECUTE FUNCTION hr_offboarding_updated_at();

DROP TRIGGER IF EXISTS hr_offboarding_assets_set_updated_at ON hr_offboarding_assets;
CREATE TRIGGER hr_offboarding_assets_set_updated_at BEFORE UPDATE ON hr_offboarding_assets
  FOR EACH ROW EXECUTE FUNCTION hr_offboarding_updated_at();
