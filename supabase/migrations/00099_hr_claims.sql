-- HR eClaims / reimbursements (P3.3, §J2)
-- Employees file expense claims with a receipt image; a store manager or HR approves.
-- An approved claim becomes a payslip EARNING in P4 (paid_at / payslip_earning_id set then);
-- here we only record the claim + approval intent.

CREATE TABLE IF NOT EXISTS hr_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,          -- derived server-side (for manager scope)
  company_id UUID REFERENCES hr_companies(id) ON DELETE SET NULL,
  claim_type TEXT NOT NULL CHECK (claim_type IN ('travel', 'medical', 'supplies', 'equipment', 'other')),
  amount_satang BIGINT NOT NULL CHECK (amount_satang > 0),
  description TEXT NOT NULL,
  receipt_path TEXT NOT NULL,                                       -- private hr-documents bucket (a bill image is required)
  claim_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'paid', 'cancelled')),
  approver_id UUID REFERENCES profiles(id),
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  paid_at TIMESTAMPTZ,                                              -- set in P4 when it hits a payslip
  payslip_earning_id UUID,                                         -- P4 link (nullable now)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS hr_claims_user_status ON hr_claims(user_id, status, claim_date DESC);
CREATE INDEX IF NOT EXISTS hr_claims_store_status ON hr_claims(store_id, status, claim_date DESC);
CREATE INDEX IF NOT EXISTS hr_claims_company_status ON hr_claims(company_id, status, claim_date DESC);

ALTER TABLE hr_claims ENABLE ROW LEVEL SECURITY;

-- Read: the claimant, company-wide HR, or a manager scoped to the claim's store.
CREATE POLICY hr_claims_read_policy ON hr_claims
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR can_manage_hr()
    OR EXISTS (SELECT 1 FROM hr_manager_scopes s WHERE s.user_id = auth.uid() AND s.store_id = hr_claims.store_id)
  );

-- Insert: an employee files their own claim.
CREATE POLICY hr_claims_insert_policy ON hr_claims
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Update: the claimant may cancel their own pending claim; HR / store managers decide.
CREATE POLICY hr_claims_update_policy ON hr_claims
  FOR UPDATE TO authenticated
  USING (
    (user_id = auth.uid() AND status = 'pending')
    OR can_manage_hr()
    OR EXISTS (SELECT 1 FROM hr_manager_scopes s WHERE s.user_id = auth.uid() AND s.store_id = hr_claims.store_id)
  )
  WITH CHECK (
    (user_id = auth.uid() AND status = 'cancelled')
    OR can_manage_hr()
    OR EXISTS (SELECT 1 FROM hr_manager_scopes s WHERE s.user_id = auth.uid() AND s.store_id = hr_claims.store_id)
  );

CREATE OR REPLACE FUNCTION hr_claims_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hr_claims_set_updated_at ON hr_claims;
CREATE TRIGGER hr_claims_set_updated_at BEFORE UPDATE ON hr_claims
  FOR EACH ROW EXECUTE FUNCTION hr_claims_updated_at();
