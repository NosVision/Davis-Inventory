-- 00090_hr_timesheet_overrides.sql
-- P2.4b: HR-editable timesheet overrides (§J8 "HR แก้ได้ + audit", §B "แก้ค่าอ่อนไหว → เหตุผล").
-- The timesheet is DERIVED from punches (P2.3b) and never mutated. When HR must correct a
-- day (a forgotten clock-out, an excused lateness, an approved OT figure), they write an
-- override row here; the timesheet APIs layer its non-null fields ON TOP of the derived
-- values (the punches stay untouched — audit/GPS-photo integrity preserved). A reason is
-- mandatory and every write is logged to hr_audit_log by the app.

create table if not exists public.hr_timesheet_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  business_date date not null,
  store_id uuid references public.stores(id) on delete set null,
  worked_min int check (worked_min is null or worked_min >= 0),
  late_min int check (late_min is null or late_min >= 0),
  ot_min int check (ot_min is null or ot_min >= 0),
  absent boolean,
  note text,
  reason text not null,
  edited_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, business_date)
);
create index if not exists hr_timesheet_overrides_user_date_idx
  on public.hr_timesheet_overrides(user_id, business_date);
create trigger hr_timesheet_overrides_set_updated_at before update on public.hr_timesheet_overrides
  for each row execute function public.hr_set_updated_at();

alter table public.hr_timesheet_overrides enable row level security;

-- an employee sees their own overrides (shown on their ESS timesheet); store managers/HR
-- see their store's. Only HR (can_manage_hr) may write — timesheet corrections are sensitive.
create policy hr_timesheet_overrides_select on public.hr_timesheet_overrides
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_store(store_id));
create policy hr_timesheet_overrides_write on public.hr_timesheet_overrides
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());
