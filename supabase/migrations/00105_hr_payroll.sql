-- 00105_hr_payroll.sql
-- P4.2 payroll engine persistence (§A). A payrun batches per-employee payslips for one
-- pay cycle (26th→25th); each payslip caches gross/sso/tax/net and itemizes every earning
-- and deduction line (§A line 79 — source + reason + ref, shown on web + printed slip).
-- The money is computed by src/lib/hr/payroll.ts (NO manual override of computed lines);
-- these tables only STORE the itemized result. Recurring per-employee allowances/deductions
-- are configured in hr_employee_recurring and fed into the engine.

-- ── recurring per-employee monthly items (allowances = earnings, fixed deductions) ──
create table if not exists public.hr_employee_recurring (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  kind text not null check (kind in ('earning', 'deduction')),
  code text not null,                      -- travel|housing|phone|cost_of_living|holiday_comp|student_loan|advance|guarantee|loan|other
  label text not null,
  amount_satang bigint not null check (amount_satang > 0),
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);
create index if not exists hr_employee_recurring_emp_idx
  on public.hr_employee_recurring(employee_id) where active;
create trigger hr_employee_recurring_set_updated_at before update on public.hr_employee_recurring
  for each row execute function public.hr_set_updated_at();

-- ── payrun (one pay cycle for a company, optionally a single store) ──
create table if not exists public.hr_payruns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.hr_companies(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  period_year int not null,
  period_month int not null check (period_month between 1 and 12),
  cycle_start date not null,               -- 26th of prev month
  cycle_end date not null,                 -- 25th of period month
  pay_date date,                           -- last working day of the month (§E)
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  note text,
  created_by uuid references public.profiles(id),
  finalized_by uuid references public.profiles(id),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One payrun per company+scope+cycle (NULL store treated as the company-wide bucket).
create unique index if not exists hr_payruns_unique
  on public.hr_payruns (company_id, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), period_year, period_month);
create trigger hr_payruns_set_updated_at before update on public.hr_payruns
  for each row execute function public.hr_set_updated_at();

-- ── payslip (one employee within a payrun; caches the engine's headline figures) ──
create table if not exists public.hr_payslips (
  id uuid primary key default gen_random_uuid(),
  payrun_id uuid not null references public.hr_payruns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  employee_id uuid references public.hr_employees(id) on delete set null,
  -- engine input snapshots (so a later rate change never rewrites history)
  rate_satang bigint not null default 0,
  pay_type text not null default 'full_monthly',
  tax_mode text not null default 'progressive',
  worked_days numeric(5,1) not null default 0,
  -- engine output caches (satang)
  gross_satang bigint not null default 0,
  sso_satang bigint not null default 0,
  tax_satang bigint not null default 0,
  total_deduction_satang bigint not null default 0,
  net_satang bigint not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payrun_id, user_id)
);
create index if not exists hr_payslips_payrun_idx on public.hr_payslips(payrun_id);
create index if not exists hr_payslips_user_idx on public.hr_payslips(user_id);
create trigger hr_payslips_set_updated_at before update on public.hr_payslips
  for each row execute function public.hr_set_updated_at();

-- ── itemized earning lines ──
create table if not exists public.hr_payslip_earnings (
  id uuid primary key default gen_random_uuid(),
  payslip_id uuid not null references public.hr_payslips(id) on delete cascade,
  type text not null check (type in ('salary','ot','allowance','service_charge','commission','eval_bonus','claim')),
  label text not null,
  amount_satang bigint not null,
  ref text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists hr_payslip_earnings_slip_idx on public.hr_payslip_earnings(payslip_id);

-- ── itemized deduction lines (every line has source + reason + ref, §A line 79) ──
create table if not exists public.hr_payslip_deductions (
  id uuid primary key default gen_random_uuid(),
  payslip_id uuid not null references public.hr_payslips(id) on delete cascade,
  type text not null check (type in ('sso','tax','late','absent','leave_unpaid','travel_leave','student_loan','advance','guarantee','loan','other')),
  label text not null,
  amount_satang bigint not null,
  reason text,
  ref text,
  sort int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists hr_payslip_deductions_slip_idx on public.hr_payslip_deductions(payslip_id);

-- ── RLS ──
alter table public.hr_employee_recurring enable row level security;
alter table public.hr_payruns enable row level security;
alter table public.hr_payslips enable row level security;
alter table public.hr_payslip_earnings enable row level security;
alter table public.hr_payslip_deductions enable row level security;

-- recurring config: HR only (salary-sensitive).
create policy hr_employee_recurring_all on public.hr_employee_recurring
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());

-- payruns: HR read/write. (Store-manager read is added in P5.5 scope work.)
create policy hr_payruns_all on public.hr_payruns
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());

-- payslips: HR read/write; an employee may read their OWN payslip (ESS slip view, P4.3).
create policy hr_payslips_select on public.hr_payslips
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_hr());
create policy hr_payslips_write on public.hr_payslips
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());

-- earning/deduction lines: readable by whoever can read the parent payslip; HR writes.
create policy hr_payslip_earnings_select on public.hr_payslip_earnings
  for select to authenticated using (
    exists (select 1 from public.hr_payslips ps where ps.id = payslip_id
            and (ps.user_id = (select auth.uid()) or public.can_manage_hr()))
  );
create policy hr_payslip_earnings_write on public.hr_payslip_earnings
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());

create policy hr_payslip_deductions_select on public.hr_payslip_deductions
  for select to authenticated using (
    exists (select 1 from public.hr_payslips ps where ps.id = payslip_id
            and (ps.user_id = (select auth.uid()) or public.can_manage_hr()))
  );
create policy hr_payslip_deductions_write on public.hr_payslip_deductions
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());
