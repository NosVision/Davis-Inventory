-- HR Service Charge pools + allocation + deductions (P4.1, §H)
-- Monthly SC pool total is entered MANUALLY (not from POS). The per-person allocation is
-- entered/edited MANUALLY by the owner (no formula). Deductions come OUT of a person's SC:
-- warnings (%/fixed baht, 200% = 2 months → carry-forward), leave days, late-repeat (P4.2),
-- evaluation (P5). Net SC per person feeds the payslip (P4.2/P4.3). Paid on the 15th.

CREATE TABLE IF NOT EXISTS hr_sc_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,                                     -- first day of the month
  total_satang BIGINT NOT NULL DEFAULT 0 CHECK (total_satang >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  pay_date DATE,                                                  -- the 15th of the next month
  notes TEXT,
  finalized_at TIMESTAMPTZ,
  finalized_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE (store_id, period_month)
);

CREATE TABLE IF NOT EXISTS hr_sc_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES hr_sc_pools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  allocated_satang BIGINT NOT NULL DEFAULT 0 CHECK (allocated_satang >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE (pool_id, user_id)
);

CREATE TABLE IF NOT EXISTS hr_sc_deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id UUID NOT NULL REFERENCES hr_sc_allocations(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('warning', 'leave', 'late', 'eval', 'manual')),
  source_ref UUID,                                               -- e.g. hr_warnings.id / hr_leaves.id
  label TEXT NOT NULL,
  amount_satang BIGINT NOT NULL CHECK (amount_satang >= 0),      -- deducted from THIS period's SC
  carry_satang BIGINT NOT NULL DEFAULT 0 CHECK (carry_satang >= 0), -- overflow carried to next period (e.g. 200%)
  note TEXT,
  auto BOOLEAN NOT NULL DEFAULT true,                            -- true = recomputed; false = manual line (preserved)
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hr_sc_pools_store_period ON hr_sc_pools(store_id, period_month DESC);
CREATE INDEX IF NOT EXISTS hr_sc_allocations_pool ON hr_sc_allocations(pool_id);
CREATE INDEX IF NOT EXISTS hr_sc_allocations_user ON hr_sc_allocations(user_id);
CREATE INDEX IF NOT EXISTS hr_sc_deductions_allocation ON hr_sc_deductions(allocation_id);

ALTER TABLE hr_sc_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_sc_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_sc_deductions ENABLE ROW LEVEL SECURITY;

-- SC data is sensitive money data: HR (owner / can_manage_hr) OR a manager scoped to the
-- pool's store may read; write is HR-only (the owner sets pools/allocations, §H).
CREATE POLICY hr_sc_pools_read ON hr_sc_pools
  FOR SELECT TO authenticated
  USING (
    can_manage_hr()
    OR EXISTS (SELECT 1 FROM hr_manager_scopes s WHERE s.user_id = auth.uid() AND s.store_id = hr_sc_pools.store_id)
  );
CREATE POLICY hr_sc_pools_write ON hr_sc_pools
  FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());

CREATE POLICY hr_sc_allocations_read ON hr_sc_allocations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hr_sc_pools p
      WHERE p.id = hr_sc_allocations.pool_id
        AND (
          can_manage_hr()
          OR EXISTS (SELECT 1 FROM hr_manager_scopes s WHERE s.user_id = auth.uid() AND s.store_id = p.store_id)
        )
    )
  );
CREATE POLICY hr_sc_allocations_write ON hr_sc_allocations
  FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());

CREATE POLICY hr_sc_deductions_read ON hr_sc_deductions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hr_sc_allocations a
      JOIN hr_sc_pools p ON p.id = a.pool_id
      WHERE a.id = hr_sc_deductions.allocation_id
        AND (
          can_manage_hr()
          OR EXISTS (SELECT 1 FROM hr_manager_scopes s WHERE s.user_id = auth.uid() AND s.store_id = p.store_id)
        )
    )
  );
CREATE POLICY hr_sc_deductions_write ON hr_sc_deductions
  FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());

CREATE OR REPLACE FUNCTION hr_sc_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hr_sc_pools_set_updated_at ON hr_sc_pools;
CREATE TRIGGER hr_sc_pools_set_updated_at BEFORE UPDATE ON hr_sc_pools
  FOR EACH ROW EXECUTE FUNCTION hr_sc_updated_at();

DROP TRIGGER IF EXISTS hr_sc_allocations_set_updated_at ON hr_sc_allocations;
CREATE TRIGGER hr_sc_allocations_set_updated_at BEFORE UPDATE ON hr_sc_allocations
  FOR EACH ROW EXECUTE FUNCTION hr_sc_updated_at();
