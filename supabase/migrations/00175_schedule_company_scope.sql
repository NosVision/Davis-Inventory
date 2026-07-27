-- 00175_schedule_company_scope.sql
-- Roster by COMPANY, not just store (owner ask 2026-07-27): everyone in the system must be
-- schedulable — housekeepers/technicians and office staff often have no user_stores membership,
-- so the store-only roster could never reach them. A schedule row (and a shift template) now
-- carries EITHER a store_id (store scope, unchanged) OR a company_id (company scope), or neither
-- (the "ไม่ระบุบริษัท" bucket for people not yet assigned to any company). All writes flow through
-- the service-role HR APIs; the employee self-read RLS policy keys on user_id and is unaffected.
alter table public.hr_schedule alter column store_id drop not null;
alter table public.hr_schedule
  add column if not exists company_id uuid references public.hr_companies(id) on delete set null;
create index if not exists hr_schedule_company_date_idx
  on public.hr_schedule(company_id, work_date);

alter table public.hr_shift_templates alter column store_id drop not null;
alter table public.hr_shift_templates
  add column if not exists company_id uuid references public.hr_companies(id) on delete cascade;
create index if not exists hr_shift_templates_company_idx
  on public.hr_shift_templates(company_id) where active;
