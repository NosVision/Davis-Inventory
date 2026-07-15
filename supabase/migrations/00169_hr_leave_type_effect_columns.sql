-- Config-driven leave pay/cert behavior (replaces hardcoded 'sick'/'personal'/'vacation' logic
-- in lib/hr/leaves.ts). New columns let HR configure each type's effect; backfill reproduces the
-- previous hardcoded classifyLeaveEffect/isCertRequired EXACTLY so no existing payroll changes.
ALTER TABLE hr_leave_types
  ADD COLUMN IF NOT EXISTS deduct_sc boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deduct_travel boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS paid_with_cert boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cert_threshold_days integer;

COMMENT ON COLUMN hr_leave_types.deduct_sc IS 'Dock the day''s Service-Charge share for a leave day';
COMMENT ON COLUMN hr_leave_types.deduct_travel IS 'Dock the monthly travel allowance per leave day';
COMMENT ON COLUMN hr_leave_types.paid_with_cert IS 'Salary preserved when a certificate is provided (e.g. sick with cert), even if the type is otherwise unpaid';
COMMENT ON COLUMN hr_leave_types.cert_threshold_days IS 'When requires_cert: a cert is needed only if the leave exceeds this many days; NULL = always';

-- Backfill = the old code-based rules, made explicit. deduct_* for non-special types = NOT paid
-- (paid types docked nothing; unpaid were treated as absent). Run before the paid correction below
-- so the else-branch reads the original paid value.
UPDATE hr_leave_types SET
  deduct_sc = CASE WHEN code = 'vacation' THEN false
                   WHEN code IN ('sick','personal') THEN true
                   ELSE NOT paid END,
  deduct_travel = CASE WHEN code = 'vacation' THEN false
                       WHEN code IN ('sick','personal') THEN true
                       ELSE NOT paid END,
  paid_with_cert = (code = 'sick'),
  cert_threshold_days = CASE WHEN code = 'sick' THEN 3 ELSE NULL END;

-- Honest base value: 'sick' (without a valid cert) and 'personal' DOCK salary under the previous
-- engine, so their true unpaid-base is false (the paid=true flag was ignored by the code path).
-- Behavior is unchanged; HR can now flip these in config if the policy differs.
UPDATE hr_leave_types SET paid = false WHERE code IN ('sick','personal');
