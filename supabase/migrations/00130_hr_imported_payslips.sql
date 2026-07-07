-- Historical payslip archive: the finalized monthly pay figures from the legacy
-- Payment spreadsheets (Baccarat / 24Amore / Savoy / UpperHouse, Jan–Jun 2026),
-- one row per person per month. These predate the live payroll engine and CANNOT
-- be recomputed, so they are stored verbatim as a read-only archive.
--
-- Rows are matched to hr_pending_identities by name at import time (pending_identity_id);
-- once a person claims their identity and becomes an hr_employee, employee_id back-links
-- so their pay history is visible in-app. Money is satang bigint; every money column is
-- NULLABLE on purpose — a blank cell on the sheet stays NULL, never a fake 0.
create table if not exists public.hr_imported_payslips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.hr_companies(id) on delete cascade,
  pending_identity_id uuid references public.hr_pending_identities(id) on delete set null,
  employee_id uuid references public.hr_employees(id) on delete set null,

  period_year int not null,
  period_month int not null check (period_month between 1 and 12),
  source text not null default 'sheet_import',
  sheet_ref text,                        -- e.g. 'Baccarat#12' — the row NO. in that month's sheet

  -- identity as printed on the sheet (kept even when matched, for audit)
  name_th text,
  name_en text,
  nickname text,
  position_text text,

  -- pay basis + time
  rate_satang bigint,                    -- monthly salary as printed
  worked_days numeric(6,2),
  off_days numeric(6,2),
  period_days numeric(6,2),

  -- earnings (satang)
  ot_hours numeric(8,2),
  ot_pay_satang bigint,
  holiday_pay_satang bigint,
  transportation_satang bigint,
  pay_transportation_satang bigint,
  service_satang bigint,                 -- service charge / tips

  -- leaves used in the cycle: {sl,slx,pl,plx,vl,vlx,h,ab,lwp,slw}
  leaves jsonb,

  -- deductions (satang)
  deduction_satang bigint,               -- AB/LATE + LWP + SLW + Other
  deduction_breakdown jsonb,

  -- authoritative totals (validated: net = gross - sso5 - sso3 - tax)
  gross_satang bigint,                   -- sheet 'Total' column
  sso5_satang bigint,
  sso3_satang bigint,
  tax_satang bigint,
  net_satang bigint,

  raw jsonb,                             -- full parsed source row, for traceability
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create unique index if not exists hr_imported_payslips_identity_period
  on public.hr_imported_payslips (pending_identity_id, period_year, period_month)
  where pending_identity_id is not null;
create index if not exists hr_imported_payslips_company_period
  on public.hr_imported_payslips (company_id, period_year, period_month);
create index if not exists hr_imported_payslips_employee
  on public.hr_imported_payslips (employee_id) where employee_id is not null;

alter table public.hr_imported_payslips enable row level security;

-- HR-only (rows carry salary/PII). Employees see their own history through the
-- ESS layer via service-role routes, never by reading this table directly.
create policy hr_imported_payslips_hr_all on public.hr_imported_payslips
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());

comment on table public.hr_imported_payslips is 'Read-only archive of legacy monthly payslip figures imported from the Payment spreadsheets; predates the live engine.';
