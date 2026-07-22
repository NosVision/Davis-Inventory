-- HR resignation requests — employee-initiated advance notice (ESS "ยื่นใบลาออก").
-- The employee submits their notice (notice date = today, desired last working date,
-- reason, signed letter) from /me; HR reviews the queue on the offboarding page and
-- either accepts (auto-creating the hr_offboarding draft, linked back here) or rejects.
-- The employee can withdraw while still pending. Signature PNGs reuse the hr-signatures
-- bucket under resignation/<id>/.

CREATE TABLE IF NOT EXISTS hr_resignation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  company_id UUID REFERENCES hr_companies(id) ON DELETE SET NULL,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  notice_date DATE NOT NULL,
  last_working_date DATE,
  reason TEXT,
  signature_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  offboarding_id UUID REFERENCES hr_offboarding(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One pending request per employee.
CREATE UNIQUE INDEX IF NOT EXISTS hr_resignation_requests_one_open
  ON hr_resignation_requests(user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS hr_resignation_requests_status
  ON hr_resignation_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS hr_resignation_requests_user
  ON hr_resignation_requests(user_id, created_at DESC);

ALTER TABLE hr_resignation_requests ENABLE ROW LEVEL SECURITY;

-- The employee reads their own requests; HR reads/writes all. Employee inserts/withdraws
-- go through the ESS API (service role) which enforces ownership itself.
CREATE POLICY hr_resignation_requests_read_policy ON hr_resignation_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR can_manage_hr());

CREATE POLICY hr_resignation_requests_write_policy ON hr_resignation_requests
  FOR ALL TO authenticated
  USING (can_manage_hr())
  WITH CHECK (can_manage_hr());

DROP TRIGGER IF EXISTS hr_resignation_requests_set_updated_at ON hr_resignation_requests;
CREATE TRIGGER hr_resignation_requests_set_updated_at BEFORE UPDATE ON hr_resignation_requests
  FOR EACH ROW EXECUTE FUNCTION hr_offboarding_updated_at();
