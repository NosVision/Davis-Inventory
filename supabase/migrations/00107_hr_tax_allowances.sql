-- P4.4: ล.ย.01 personal tax allowances (ลดหย่อนภาษี) per employee, itemized.
-- Feeds the progressive PND1 withholding: the ANNUAL sum of active rows is deducted from
-- annual taxable income (on top of the standard ฿60k personal allowance + 50%/฿100k expense
-- + ฿9k SSO which the engine already applies). Amounts are ANNUAL baht (ล.ย.01 is filed per
-- tax year), stored as integer satang for exactness.
--
-- kind = spouse / child / parent / disabled_dependant / life_insurance / health_insurance
--        / parent_health_insurance / provident_fund / rmf / ssf / home_loan_interest
--        / social_enterprise / donation / other  (validated in the app; free 'other' allowed)

create table if not exists public.hr_tax_allowances (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.hr_employees(id) on delete cascade,
  tax_year     int  not null,                       -- Gregorian tax year, e.g. 2026
  kind         text not null,
  label        text,                                 -- optional human note (e.g. child name)
  amount_satang bigint not null check (amount_satang >= 0),
  active       boolean not null default true,
  note         text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists hr_tax_allowances_emp_year
  on public.hr_tax_allowances (employee_id, tax_year) where active;

alter table public.hr_tax_allowances enable row level security;

-- HR-only: tax allowances are sensitive personal data (§B). No self-read for employees.
drop policy if exists hr_tax_allowances_select on public.hr_tax_allowances;
create policy hr_tax_allowances_select on public.hr_tax_allowances
  for select to authenticated using (public.can_manage_hr());

drop policy if exists hr_tax_allowances_write on public.hr_tax_allowances;
create policy hr_tax_allowances_write on public.hr_tax_allowances
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());
