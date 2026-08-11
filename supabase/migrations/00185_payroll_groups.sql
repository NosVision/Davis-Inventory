-- 00185_payroll_groups.sql
-- Applied to production 2026-08-11.
--
-- Split one company's payroll into separate runs so different HR users can each own a slice —
-- starting with "the accounting team's payroll is May's, and nobody else's people get mixed in",
-- with more splits expected later.
--
-- Deliberately a SEPARATE axis from hr_employees.pay_confidential:
--   payroll_group_id  → WHICH RUN a person belongs to   (division of labour)
--   pay_confidential  → WHO MAY SEE their figures       (confidentiality)
-- They cover the same ten people today and need not tomorrow — the owner already expects to split
-- payroll further without hiding those salaries.
--
-- Backwards compatible: employees with no group form the default slice, which is what a payrun
-- with payroll_group_id IS NULL covers. All 14 existing runs stay valid and nothing has to be
-- assigned for payroll to keep working exactly as it does today.

create table if not exists public.hr_payroll_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.hr_companies(id) on delete cascade,
  name text not null,
  note text,
  sort_order int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

comment on table public.hr_payroll_groups is
  'A slice of one company''s payroll that is run separately. Employees with no group form the default ("ยังไม่จัดกลุ่ม") slice, which is what a payrun with payroll_group_id IS NULL covers.';

alter table public.hr_employees
  add column if not exists payroll_group_id uuid references public.hr_payroll_groups(id) on delete set null;

create index if not exists idx_hr_employees_payroll_group on public.hr_employees (payroll_group_id);

alter table public.hr_payruns
  add column if not exists payroll_group_id uuid references public.hr_payroll_groups(id) on delete restrict;

-- One run per company + store + GROUP + period. Without the group in the key a company could only
-- ever have one run per month — exactly what blocked splitting.
drop index if exists public.hr_payruns_unique;
create unique index hr_payruns_unique on public.hr_payruns (
  company_id,
  coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(payroll_group_id, '00000000-0000-0000-0000-000000000000'::uuid),
  period_year,
  period_month
);

alter table public.hr_payroll_groups enable row level security;

create policy "hr_payroll_groups_select" on public.hr_payroll_groups
  for select to authenticated using (can_manage_hr());
create policy "hr_payroll_groups_write" on public.hr_payroll_groups
  for all to authenticated using (can_manage_hr()) with check (can_manage_hr());
