-- P3.2 review MED: the 3 required signatures (employee, manager, HR) must come from 3
-- DISTINCT people. requireStoreManager passes for company-wide HR too, so without this a
-- single HR admin could sign both the 'manager' and 'hr' roles. Enforce one signature per
-- signer per warning (the existing UNIQUE(warning_id, role) still bounds roles to one each).
CREATE UNIQUE INDEX IF NOT EXISTS hr_warning_signatures_one_per_signer
  ON hr_warning_signatures (warning_id, signed_by);
