-- HR Tip pool + allocation + deductions (P4.4) — SAME mechanism as Service Charge (00103).
-- A monthly tip pool total is entered MANUALLY; the per-person allocation is set/edited
-- manually; deductions come out of a person's tip share (manual, or auto from warnings/eval
-- if the client later wants it). Net tip per person feeds the payslip as a 'tip' earning line.
-- Unlike SC, tips are NOT gated on pay type (part-timers can share tips).

CREATE TABLE IF NOT EXISTS hr_tip_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  total_satang BIGINT NOT NULL DEFAULT 0 CHECK (total_satang >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  pay_date DATE,
  notes TEXT,
  finalized_at TIMESTAMPTZ,
  finalized_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE (store_id, period_month)
);

CREATE TABLE IF NOT EXISTS hr_tip_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES hr_tip_pools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  allocated_satang BIGINT NOT NULL DEFAULT 0 CHECK (allocated_satang >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE (pool_id, user_id)
);

CREATE TABLE IF NOT EXISTS hr_tip_deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id UUID NOT NULL REFERENCES hr_tip_allocations(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('warning', 'leave', 'eval', 'manual')),
  source_ref UUID,
  label TEXT NOT NULL,
  amount_satang BIGINT NOT NULL CHECK (amount_satang >= 0),
  carry_satang BIGINT NOT NULL DEFAULT 0 CHECK (carry_satang >= 0),
  note TEXT,
  auto BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hr_tip_pools_store_period ON hr_tip_pools(store_id, period_month DESC);
CREATE INDEX IF NOT EXISTS hr_tip_allocations_pool ON hr_tip_allocations(pool_id);
CREATE INDEX IF NOT EXISTS hr_tip_allocations_user ON hr_tip_allocations(user_id);
CREATE INDEX IF NOT EXISTS hr_tip_deductions_allocation ON hr_tip_deductions(allocation_id);

ALTER TABLE hr_tip_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_tip_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_tip_deductions ENABLE ROW LEVEL SECURITY;

-- Same visibility as SC: HR or a manager scoped to the pool's store may read; write is HR-only.
CREATE POLICY hr_tip_pools_read ON hr_tip_pools
  FOR SELECT TO authenticated
  USING (
    can_manage_hr()
    OR EXISTS (SELECT 1 FROM hr_manager_scopes s WHERE s.user_id = auth.uid() AND s.store_id = hr_tip_pools.store_id)
  );
CREATE POLICY hr_tip_pools_write ON hr_tip_pools
  FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());

CREATE POLICY hr_tip_allocations_read ON hr_tip_allocations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hr_tip_pools p
      WHERE p.id = hr_tip_allocations.pool_id
        AND (
          can_manage_hr()
          OR EXISTS (SELECT 1 FROM hr_manager_scopes s WHERE s.user_id = auth.uid() AND s.store_id = p.store_id)
        )
    )
  );
CREATE POLICY hr_tip_allocations_write ON hr_tip_allocations
  FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());

CREATE POLICY hr_tip_deductions_read ON hr_tip_deductions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hr_tip_allocations a
      JOIN hr_tip_pools p ON p.id = a.pool_id
      WHERE a.id = hr_tip_deductions.allocation_id
        AND (
          can_manage_hr()
          OR EXISTS (SELECT 1 FROM hr_manager_scopes s WHERE s.user_id = auth.uid() AND s.store_id = p.store_id)
        )
    )
  );
CREATE POLICY hr_tip_deductions_write ON hr_tip_deductions
  FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());
