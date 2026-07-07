-- Per-company flat withholding-tax rate for employees whose tax_mode = 'withholding_3pct'.
-- Was a hardcoded 0.03 in the payroll engine (computePayslip); now an owner-tunable per-entity
-- knob like sso_rate / day_divisor / ot_multipliers. Default 0.03 keeps every existing slip
-- byte-identical, so applying this migration changes no computed number until an owner edits it.
alter table public.hr_companies
  add column if not exists wht_rate numeric(5,4) not null default 0.03;

comment on column public.hr_companies.wht_rate is
  'Flat withholding-tax rate applied when an employee''s tax_mode = withholding_3pct (default 0.03 = 3%). Owner-editable on the Companies page; changing it is audited like other payroll parameters.';
