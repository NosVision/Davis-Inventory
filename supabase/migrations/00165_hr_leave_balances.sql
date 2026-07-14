-- 00165: per-employee leave quota overrides (owner ask 2026-07-14 — the legacy SALARY sheet's
-- "พักร้อนคงเหลือ" column E kept a per-person vacation balance; the system only had a per-TYPE
-- annual_quota_days, identical for everyone).
--
-- Effective quota for (employee, type, year) = hr_leave_balances.quota_days when a row exists,
-- else hr_leave_types.annual_quota_days. Used = Σ approved hr_leaves.days of that type in the
-- year. HR keys the sheet values in on /hr/leaves (no machine import — the parsed legacy JSON
-- never captured column E).

create table if not exists public.hr_leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  leave_type_id uuid not null references public.hr_leave_types(id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  quota_days numeric(5,1) not null check (quota_days >= 0),
  note text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, leave_type_id, year)
);

alter table public.hr_leave_balances enable row level security;
create policy hr_leave_balances_hr_all on public.hr_leave_balances
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());
