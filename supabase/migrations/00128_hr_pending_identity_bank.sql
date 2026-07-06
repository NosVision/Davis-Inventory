-- Enrich the imported identity pool with what the Payment file also carries per person:
-- bank + account number (BV/BW columns — needed for the future 2-round bank export),
-- the English name (May file has them filled; helps matching Thai names to app accounts)
-- and the accountant's employee code where a returned .xlsm provided one. On approve these
-- flow into hr_employees so payroll starts complete.
alter table public.hr_pending_identities
  add column bank_name text,
  add column bank_account_no text,
  add column full_name_en text,
  add column employee_code text;
