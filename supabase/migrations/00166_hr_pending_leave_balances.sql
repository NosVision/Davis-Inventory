-- 00166: staged vacation balances for not-yet-registered staff (owner sheet import 2026-07-14).
-- The SALARY sheet carries a "พักร้อนคงเหลือ" balance for people who exist only in
-- hr_pending_identities (imported roster, no app account yet). Stage those balances here;
-- when the person registers/claims and an hr_employees row is created for their identity,
-- the balances materialize into hr_leave_balances (see src/lib/hr/leave-balance-link.ts)
-- and the staged rows are stamped consumed_at/consumed_employee_id.

create table if not exists public.hr_pending_leave_balances (
  id uuid primary key default gen_random_uuid(),
  pending_identity_id uuid not null references public.hr_pending_identities(id) on delete cascade,
  leave_type_code text not null default 'vacation',
  year int not null check (year between 2000 and 2100),
  quota_days numeric(5,1) not null check (quota_days >= 0),
  note text,
  consumed_at timestamptz,
  consumed_employee_id uuid references public.hr_employees(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (pending_identity_id, leave_type_code, year)
);

alter table public.hr_pending_leave_balances enable row level security;
create policy hr_pending_leave_balances_hr_all on public.hr_pending_leave_balances
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());

-- Seed a 'vacation' leave type for every company that lacks one — same values 00092 seeded
-- for HR Test Co (paid, 6 days/year, 7 days advance notice, not allowed during probation) —
-- so imported/staged balances always have a company-scoped type to attach to.
insert into public.hr_leave_types
  (company_id, code, name_th, name_en, paid, annual_quota_days, advance_notice_days, probational_allowed, sort_order)
select c.id, 'vacation', 'ลาพักร้อน', 'Vacation Leave', true, 6, 7, false, 3
from public.hr_companies c
where not exists (
  select 1 from public.hr_leave_types t where t.company_id = c.id and t.code = 'vacation'
);
