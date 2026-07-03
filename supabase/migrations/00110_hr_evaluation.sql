-- HR monthly evaluation engine (P5.1, §G). Data flow: period → criteria → assignment →
-- raw scores → averaged result → payout rule → payout. "HR sets policy as data, the system
-- computes" (same shape as hr_leave_types). Pure math lives in src/lib/hr/evaluation.ts.
-- Money = integer satang; score_pct = numeric 0..100.

-- 1) periods — one per month (optionally per store-set). max_score caches Σ criteria points.
CREATE TABLE IF NOT EXISTS hr_eval_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month DATE NOT NULL,                                   -- first of month
  title TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'company' CHECK (scope_type IN ('company', 'stores')),
  max_score INTEGER NOT NULL DEFAULT 0 CHECK (max_score >= 0), -- cache of Σ criteria.max_points
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'void')),
  scoring_opens_at TIMESTAMPTZ,
  scoring_closes_at TIMESTAMPTZ,
  reopened_count INTEGER NOT NULL DEFAULT 0,
  reopen_reason TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- store scope: HR-A can run a different period/criteria than HR-B in the same month
CREATE TABLE IF NOT EXISTS hr_eval_period_stores (
  period_id UUID NOT NULL REFERENCES hr_eval_periods(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  PRIMARY KEY (period_id, store_id)
);

-- 2) criteria — free topics + max points; editable only while draft (default 15 from the manual)
CREATE TABLE IF NOT EXISTS hr_eval_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES hr_eval_periods(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  max_points INTEGER NOT NULL CHECK (max_points > 0),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) assignments — who evaluates whom (multi-evaluator = multiple rows, one employee)
CREATE TABLE IF NOT EXISTS hr_eval_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES hr_eval_periods(id) ON DELETE CASCADE,
  evaluator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id),                          -- snapshot
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'submitted', 'withdrawn')),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_id, evaluator_id, employee_id),
  CHECK (evaluator_id <> employee_id)
);

-- 4) raw scores — points per criterion per (evaluator,employee) pair; 0..criterion.max_points
CREATE TABLE IF NOT EXISTS hr_eval_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES hr_eval_assignments(id) ON DELETE CASCADE,
  criterion_id UUID NOT NULL REFERENCES hr_eval_criteria(id) ON DELETE CASCADE,
  points NUMERIC NOT NULL CHECK (points >= 0),                  -- upper bound enforced in app/trigger vs criterion.max
  comment TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assignment_id, criterion_id)
);

-- 5) results — averaged + normalized, one row per employee per period
CREATE TABLE IF NOT EXISTS hr_eval_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES hr_eval_periods(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  evaluator_count INTEGER NOT NULL DEFAULT 0,
  raw_score_avg NUMERIC NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL DEFAULT 0,                         -- snapshot
  score_pct NUMERIC CHECK (score_pct IS NULL OR (score_pct >= 0 AND score_pct <= 100)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'computed', 'stale', 'locked')),
  computed_at TIMESTAMPTZ,
  UNIQUE (period_id, employee_id)
);

-- 6) payout rules + tiers — score_pct → money, independent per period
CREATE TABLE IF NOT EXISTS hr_eval_payout_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES hr_eval_periods(id) ON DELETE CASCADE,
  formula_type TEXT NOT NULL CHECK (formula_type IN ('tiered', 'linear')),
  flat_satang BIGINT NOT NULL DEFAULT 0,                        -- linear
  satang_per_pct BIGINT NOT NULL DEFAULT 0,                     -- linear
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_id)                                            -- one active rule per period (v1)
);

CREATE TABLE IF NOT EXISTS hr_eval_payout_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES hr_eval_payout_rules(id) ON DELETE CASCADE,
  min_pct NUMERIC NOT NULL CHECK (min_pct >= 0 AND min_pct <= 100),
  max_pct NUMERIC NOT NULL CHECK (max_pct >= 0 AND max_pct <= 100),
  amount_satang BIGINT NOT NULL,                               -- may be NEGATIVE (deduct from SC, §G↔§H)
  label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  CHECK (max_pct >= min_pct)
);

-- 7) payouts — actual money per employee per period, with a frozen formula snapshot
CREATE TABLE IF NOT EXISTS hr_eval_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id UUID NOT NULL REFERENCES hr_eval_results(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES hr_eval_payout_rules(id) ON DELETE SET NULL,
  tier_matched_id UUID REFERENCES hr_eval_payout_tiers(id) ON DELETE SET NULL,
  input_pct_score NUMERIC NOT NULL,                            -- snapshot
  formula_snapshot JSONB,                                       -- frozen rule
  amount_satang BIGINT NOT NULL,                               -- may be negative
  calculation_note TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'applied_to_payslip', 'superseded', 'void')),
  corrected_from_id UUID REFERENCES hr_eval_payouts(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hr_eval_periods_month ON hr_eval_periods(period_month DESC);
CREATE INDEX IF NOT EXISTS hr_eval_criteria_period ON hr_eval_criteria(period_id, sort_order);
CREATE INDEX IF NOT EXISTS hr_eval_assign_period ON hr_eval_assignments(period_id);
CREATE INDEX IF NOT EXISTS hr_eval_assign_evaluator ON hr_eval_assignments(evaluator_id);
CREATE INDEX IF NOT EXISTS hr_eval_scores_assignment ON hr_eval_scores(assignment_id);
CREATE INDEX IF NOT EXISTS hr_eval_results_period ON hr_eval_results(period_id);
CREATE INDEX IF NOT EXISTS hr_eval_results_employee ON hr_eval_results(employee_id);
CREATE INDEX IF NOT EXISTS hr_eval_tiers_rule ON hr_eval_payout_tiers(rule_id, sort_order);
CREATE INDEX IF NOT EXISTS hr_eval_payouts_result ON hr_eval_payouts(result_id);

ALTER TABLE hr_eval_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_eval_period_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_eval_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_eval_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_eval_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_eval_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_eval_payout_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_eval_payout_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_eval_payouts ENABLE ROW LEVEL SECURITY;

-- ── RLS (§G visibility, 2 layers — RLS here + app-layer). HR-write everywhere; targeted reads. ──
-- config tables: HR-only (periods/criteria/period_stores/rules/tiers/payouts)
CREATE POLICY hr_eval_periods_all ON hr_eval_periods FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());
CREATE POLICY hr_eval_period_stores_all ON hr_eval_period_stores FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());
CREATE POLICY hr_eval_criteria_all ON hr_eval_criteria FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());
CREATE POLICY hr_eval_rules_all ON hr_eval_payout_rules FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());
CREATE POLICY hr_eval_tiers_all ON hr_eval_payout_tiers FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());
CREATE POLICY hr_eval_payouts_all ON hr_eval_payouts FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());

-- assignments: HR full; an evaluator sees + updates ONLY their own rows (no roster endpoint for regular roles)
CREATE POLICY hr_eval_assign_hr ON hr_eval_assignments FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());
CREATE POLICY hr_eval_assign_own_read ON hr_eval_assignments FOR SELECT TO authenticated USING (evaluator_id = (SELECT auth.uid()));
CREATE POLICY hr_eval_assign_own_update ON hr_eval_assignments FOR UPDATE TO authenticated
  USING (evaluator_id = (SELECT auth.uid())) WITH CHECK (evaluator_id = (SELECT auth.uid()));

-- scores: HR full; an evaluator reads/writes scores only for their OWN assignments
CREATE POLICY hr_eval_scores_hr ON hr_eval_scores FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());
CREATE POLICY hr_eval_scores_own ON hr_eval_scores FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM hr_eval_assignments a WHERE a.id = hr_eval_scores.assignment_id AND a.evaluator_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM hr_eval_assignments a WHERE a.id = hr_eval_scores.assignment_id AND a.evaluator_id = (SELECT auth.uid())));

-- results: HR full; an employee reads ONLY their own result row
CREATE POLICY hr_eval_results_hr ON hr_eval_results FOR ALL TO authenticated USING (can_manage_hr()) WITH CHECK (can_manage_hr());
CREATE POLICY hr_eval_results_own_read ON hr_eval_results FOR SELECT TO authenticated USING (employee_id = (SELECT auth.uid()));
