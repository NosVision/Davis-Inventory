-- P3.1 review HIGH: hr_leave_types.code was globally UNIQUE, which blocks a second
-- company from seeding the standard codes (sick/personal/vacation/...) that
-- classifyLeaveEffect keys on. Make code unique PER COMPANY, plus unique among global
-- (company_id IS NULL) types.
ALTER TABLE hr_leave_types DROP CONSTRAINT IF EXISTS hr_leave_types_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS hr_leave_types_company_code
  ON hr_leave_types (company_id, code) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hr_leave_types_global_code
  ON hr_leave_types (code) WHERE company_id IS NULL;
