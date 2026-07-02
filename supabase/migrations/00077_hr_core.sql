-- 00077_hr_core.sql
-- HR system P0 foundation: companies, positions, departments, employees, audit log, manager scopes.
-- Money is stored in satang (int/bigint). Times are Asia/Bangkok in the app layer; DB stores timestamptz.
-- Only touches hr_* tables + FKs that READ profiles/stores. Does NOT alter any existing stock/POS tables.
-- RLS convention matches existing helpers: get_user_role(), get_user_store_ids(), is_admin().
-- New gate helper: can_manage_hr() = owner OR user_permissions row 'can_manage_hr'.

-- ---------------------------------------------------------------------------
-- shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_hr()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'owner'::public.user_role
  ) or exists (
    select 1 from public.user_permissions where user_id = auth.uid() and permission = 'can_manage_hr'
  );
$$;

comment on function public.can_manage_hr() is 'True for owner or any user granted the can_manage_hr permission. Gate for all hr_* management.';

create or replace function public.hr_set_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- hr_companies (§A) — legal entities / payroll config. CRUD by HR.
-- ---------------------------------------------------------------------------
create table if not exists public.hr_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  tax_id text,
  payslip_paper text not null default '9x5.5in',
  sso_rate numeric(5,4) not null default 0.05,          -- 5%
  sso_wage_ceiling_satang bigint not null default 1750000, -- 17,500 THB -> max SSO 875 THB
  day_divisor int not null default 30,                  -- salary = rate / 30 * worked days
  ot_multipliers jsonb not null default '{"ot1":1.5,"ot2":2,"ot3":3}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);
create trigger hr_companies_set_updated_at before update on public.hr_companies
  for each row execute function public.hr_set_updated_at();

-- ---------------------------------------------------------------------------
-- hr_positions (§I) — job titles, NOT system roles. CRUD by HR. Seed 16.
-- ---------------------------------------------------------------------------
create table if not exists public.hr_positions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.hr_positions (name, sort_order) values
  ('Manager', 1),
  ('Assistant Manager', 2),
  ('Captain', 3),
  ('Head Bar', 4),
  ('Bartender', 5),
  ('Bar Back', 6),
  ('Cashier', 7),
  ('Service', 8),
  ('Runner', 9),
  ('Head Hostess', 10),
  ('Housekeeping', 11),
  ('Security', 12),
  ('Admin', 13),
  ('Sound Engineer', 14),
  ('Graphic', 15),
  ('Assistant', 16)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- hr_departments (J7) — CRUD by HR.
-- ---------------------------------------------------------------------------
create table if not exists public.hr_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- hr_employees (§A/§I) — one HR record per person (profiles).
--   rate_satang meaning depends on pay_type:
--     full_monthly / pt_monthly -> monthly salary in satang
--     pt_daily                  -> per-day rate in satang
--     pt_hourly                 -> per-hour rate in satang
-- ---------------------------------------------------------------------------
create table if not exists public.hr_employees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  company_id uuid references public.hr_companies(id),
  position_id uuid references public.hr_positions(id),
  department_id uuid references public.hr_departments(id),
  supervisor_id uuid references public.profiles(id),
  employee_code text unique,

  -- pay
  rate_satang bigint not null default 0,
  pay_type text not null default 'full_monthly'
    check (pay_type in ('full_monthly','pt_hourly','pt_daily','pt_monthly')),

  -- time profile (§I)
  work_hours_per_day int not null default 8 check (work_hours_per_day in (8,9)),
  break_hours numeric(4,2) not null default 1,
  ot_eligible boolean not null default false,
  ot_hour_divisor int not null default 8 check (ot_hour_divisor in (8,9)),
  standard_days_off int not null default 6 check (standard_days_off in (6,8)),

  -- tax / sso (§A)
  tax_mode text not null default 'progressive'
    check (tax_mode in ('progressive','withholding_3pct','none')),
  sso_enrolled boolean not null default true,

  -- identity / banking / docs
  bank_name text,
  bank_account_no text,
  bank_account_name text,
  sso_no text,
  tax_id text,
  emergency_contact jsonb,                 -- { name, phone, relation }
  documents jsonb not null default '[]'::jsonb, -- [{ type, url, uploaded_at }]

  -- employment lifecycle
  start_date date,
  probation_end date,                      -- 119-day probation
  status text not null default 'active'
    check (status in ('active','probation','resigned','terminated')),
  end_date date,
  end_reason text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id)
);
create index if not exists hr_employees_company_idx on public.hr_employees(company_id);
create index if not exists hr_employees_position_idx on public.hr_employees(position_id);
create index if not exists hr_employees_department_idx on public.hr_employees(department_id);
create index if not exists hr_employees_status_idx on public.hr_employees(status);
create trigger hr_employees_set_updated_at before update on public.hr_employees
  for each row execute function public.hr_set_updated_at();

-- ---------------------------------------------------------------------------
-- hr_audit_log (§B) — every hr_* mutation. Written server-side (service role).
-- ---------------------------------------------------------------------------
create table if not exists public.hr_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null check (action in ('create','update','delete')),
  table_name text not null,
  record_id uuid,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists hr_audit_log_record_idx on public.hr_audit_log(table_name, record_id);
create index if not exists hr_audit_log_actor_idx on public.hr_audit_log(actor_id);
create index if not exists hr_audit_log_created_idx on public.hr_audit_log(created_at desc);

-- ---------------------------------------------------------------------------
-- hr_manager_scopes — narrows a can_manage_hr user to specific stores (venues).
--   P0: table only; store-scoped RLS refinement lands in later phases.
-- ---------------------------------------------------------------------------
create table if not exists public.hr_manager_scopes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (user_id, store_id)
);
create index if not exists hr_manager_scopes_user_idx on public.hr_manager_scopes(user_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.hr_companies       enable row level security;
alter table public.hr_positions       enable row level security;
alter table public.hr_departments     enable row level security;
alter table public.hr_employees       enable row level security;
alter table public.hr_audit_log       enable row level security;
alter table public.hr_manager_scopes  enable row level security;

-- config/reference tables: authenticated may read (dropdowns); only HR may write.
create policy hr_companies_select on public.hr_companies
  for select to authenticated using (true);
create policy hr_companies_write on public.hr_companies
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());

create policy hr_positions_select on public.hr_positions
  for select to authenticated using (true);
create policy hr_positions_write on public.hr_positions
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());

create policy hr_departments_select on public.hr_departments
  for select to authenticated using (true);
create policy hr_departments_write on public.hr_departments
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());

-- employees: a person sees their own record; HR sees/writes all.
create policy hr_employees_select on public.hr_employees
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.can_manage_hr());
create policy hr_employees_write on public.hr_employees
  for all to authenticated
  using (public.can_manage_hr()) with check (public.can_manage_hr());

-- audit log: HR reads; authenticated may only insert rows attributed to themselves
-- (server writes with service role and bypasses RLS anyway).
create policy hr_audit_log_select on public.hr_audit_log
  for select to authenticated using (public.can_manage_hr());
create policy hr_audit_log_insert on public.hr_audit_log
  for insert to authenticated with check (actor_id = (select auth.uid()));

-- manager scopes: HR (or the scoped user) may read; only owner may grant/revoke.
create policy hr_manager_scopes_select on public.hr_manager_scopes
  for select to authenticated
  using (public.can_manage_hr() or user_id = (select auth.uid()));
create policy hr_manager_scopes_write on public.hr_manager_scopes
  for all to authenticated
  using (public.get_user_role() = 'owner'::public.user_role)
  with check (public.get_user_role() = 'owner'::public.user_role);
