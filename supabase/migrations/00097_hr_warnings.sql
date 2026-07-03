-- HR Disciplinary Warnings (P3.2)
-- §E disciplinary ladder + §H money rules:
--   levels: วาจา(verbal) / หัก SC 25% / 50% / 100% / 200%(= SC 2 เดือน carry-forward) / ระบุบาทเอง
--   warnings deduct from SERVICE CHARGE only, never salary (the SC deduction LINE lands in P4.1).
--   3-party signatures (employee + manager + HR), warning valid 12 months (§E).

CREATE TABLE IF NOT EXISTS hr_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,          -- the employee
  issued_by UUID NOT NULL REFERENCES profiles(id),                          -- HR or manager who issued
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,                   -- store context (for manager scope)
  company_id UUID REFERENCES hr_companies(id) ON DELETE SET NULL,
  level TEXT NOT NULL CHECK (level IN ('verbal', 'deduct_25', 'deduct_50', 'deduct_100', 'deduct_200', 'amount_baht')),
  -- SC deduction intent (consumed by P4.1 payroll; recorded here at issue time):
  sc_deduct_percent INTEGER CHECK (sc_deduct_percent IS NULL OR (sc_deduct_percent >= 0 AND sc_deduct_percent <= 200)),
  amount_satang BIGINT CHECK (amount_satang IS NULL OR amount_satang > 0),  -- only for level='amount_baht'
  sc_deduct_cycles INTEGER NOT NULL DEFAULT 1 CHECK (sc_deduct_cycles >= 0),-- 200% = 2 (carry-forward), verbal = 0, else 1
  reason TEXT NOT NULL,
  detail TEXT,
  evidence_path TEXT,                                                       -- private hr-documents bucket
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '12 months'),   -- §E: warning valid 12 months
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'void')),
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id),
  -- amount_satang is required iff the level is the free-form baht level.
  CONSTRAINT hr_warnings_amount_matches_level CHECK (
    (level = 'amount_baht' AND amount_satang IS NOT NULL)
    OR (level <> 'amount_baht' AND amount_satang IS NULL)
  )
);

-- 3-party signatures: employee, manager, HR — one row per role per warning.
CREATE TABLE IF NOT EXISTS hr_warning_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warning_id UUID NOT NULL REFERENCES hr_warnings(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'hr')),
  signed_by UUID NOT NULL REFERENCES profiles(id),
  signature_path TEXT NOT NULL,                                             -- private hr-documents bucket
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (warning_id, role)
);

CREATE INDEX IF NOT EXISTS hr_warnings_user_status ON hr_warnings(user_id, status, issued_at DESC);
CREATE INDEX IF NOT EXISTS hr_warnings_store_status ON hr_warnings(store_id, status, issued_at DESC);
CREATE INDEX IF NOT EXISTS hr_warning_signatures_warning ON hr_warning_signatures(warning_id);

-- RLS
ALTER TABLE hr_warnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_warning_signatures ENABLE ROW LEVEL SECURITY;

-- Warnings: read = the employee themself OR company-wide HR OR a manager scoped to the store.
CREATE POLICY hr_warnings_read_policy ON hr_warnings
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR can_manage_hr()
    OR EXISTS (
      SELECT 1 FROM hr_manager_scopes s
      WHERE s.user_id = auth.uid() AND s.store_id = hr_warnings.store_id
    )
  );

-- Write = HR OR a manager scoped to the store (all app mutations go through the service client;
-- this is the defense-in-depth backstop).
CREATE POLICY hr_warnings_write_policy ON hr_warnings
  FOR ALL TO authenticated
  USING (
    can_manage_hr()
    OR EXISTS (
      SELECT 1 FROM hr_manager_scopes s
      WHERE s.user_id = auth.uid() AND s.store_id = hr_warnings.store_id
    )
  )
  WITH CHECK (
    can_manage_hr()
    OR EXISTS (
      SELECT 1 FROM hr_manager_scopes s
      WHERE s.user_id = auth.uid() AND s.store_id = hr_warnings.store_id
    )
  );

-- Signatures: readable to anyone who can read the parent warning.
CREATE POLICY hr_warning_signatures_read_policy ON hr_warning_signatures
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hr_warnings w
      WHERE w.id = hr_warning_signatures.warning_id
        AND (
          w.user_id = auth.uid()
          OR can_manage_hr()
          OR EXISTS (
            SELECT 1 FROM hr_manager_scopes s
            WHERE s.user_id = auth.uid() AND s.store_id = w.store_id
          )
        )
    )
  );

-- Signature inserts happen through the service client (app derives+authorizes the role);
-- the employee may sign their own warning, HR/manager the parent-scoped roles.
CREATE POLICY hr_warning_signatures_insert_policy ON hr_warning_signatures
  FOR INSERT TO authenticated
  WITH CHECK (
    signed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM hr_warnings w
      WHERE w.id = hr_warning_signatures.warning_id
        AND (
          w.user_id = auth.uid()
          OR can_manage_hr()
          OR EXISTS (
            SELECT 1 FROM hr_manager_scopes s
            WHERE s.user_id = auth.uid() AND s.store_id = w.store_id
          )
        )
    )
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION hr_warnings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hr_warnings_set_updated_at ON hr_warnings;
CREATE TRIGGER hr_warnings_set_updated_at BEFORE UPDATE ON hr_warnings
  FOR EACH ROW EXECUTE FUNCTION hr_warnings_updated_at();
