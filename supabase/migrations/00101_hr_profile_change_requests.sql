-- HR ESS profile-change requests (P3.4a, §J6)
-- Employees request changes to their own sensitive profile fields; HR must approve.
-- §J6: a BANK-ACCOUNT change ALWAYS requires approval. On approve the change is applied
-- to hr_employees (audited via hr_audit_log).

CREATE TABLE IF NOT EXISTS hr_profile_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,   -- the employee (self)
  field_key TEXT NOT NULL CHECK (field_key IN ('bank_account', 'emergency_contact')),
  current_value JSONB,                                               -- snapshot at filing (for HR to compare)
  new_value JSONB NOT NULL,                                          -- requested value
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approver_id UUID REFERENCES profiles(id),
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  applied BOOLEAN NOT NULL DEFAULT false,                            -- true once written to hr_employees
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS hr_pcr_user_status ON hr_profile_change_requests(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS hr_pcr_status ON hr_profile_change_requests(status, created_at DESC);

-- One open (pending) request per field per user.
CREATE UNIQUE INDEX IF NOT EXISTS hr_pcr_one_open_per_field
  ON hr_profile_change_requests(user_id, field_key)
  WHERE status = 'pending';

ALTER TABLE hr_profile_change_requests ENABLE ROW LEVEL SECURITY;

-- Read: the requester themself or company-wide HR (these carry sensitive bank data —
-- store managers do NOT get access; approval is HR-only per §J6).
CREATE POLICY hr_pcr_read_policy ON hr_profile_change_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR can_manage_hr());

CREATE POLICY hr_pcr_insert_policy ON hr_profile_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Update: employee may cancel their own pending request; HR decides.
CREATE POLICY hr_pcr_update_policy ON hr_profile_change_requests
  FOR UPDATE TO authenticated
  USING ((user_id = auth.uid() AND status = 'pending') OR can_manage_hr())
  WITH CHECK ((user_id = auth.uid() AND status = 'cancelled') OR can_manage_hr());

CREATE POLICY hr_pcr_delete_policy ON hr_profile_change_requests
  FOR DELETE TO authenticated USING (false);

CREATE OR REPLACE FUNCTION hr_pcr_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hr_pcr_set_updated_at ON hr_profile_change_requests;
CREATE TRIGGER hr_pcr_set_updated_at BEFORE UPDATE ON hr_profile_change_requests
  FOR EACH ROW EXECUTE FUNCTION hr_pcr_updated_at();
