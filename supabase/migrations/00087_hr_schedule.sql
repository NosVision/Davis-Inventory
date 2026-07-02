-- 00087_hr_schedule.sql
-- P2.2 scheduling (§C). The STORE MANAGER builds a monthly roster (who works which
-- shift / who is off, per day), submits it for HR to acknowledge, and employees see
-- their own published shifts (ESS). Time records later reconcile against this roster.
--
-- Authorization: a store's schedule is managed by that store's manager(s)
-- (hr_manager_scopes) OR anyone with company-wide HR rights (can_manage_hr). We add a
-- can_manage_store() helper so RLS and the app share one definition.

-- ---------------------------------------------------------------------------
-- Authorization helper: HR (owner / can_manage_hr) OR a manager scoped to the store.
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_hr()
      or exists (
        select 1 from public.hr_manager_scopes ms
        where ms.user_id = auth.uid() and ms.store_id = p_store_id
      );
$$;

-- ---------------------------------------------------------------------------
-- Shift templates: reusable named shifts per store (e.g. Morning 12:00–20:00,
-- Night 17:00–01:00). end_time < start_time denotes an overnight shift.
-- ---------------------------------------------------------------------------
create table if not exists public.hr_shift_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  label text not null,
  start_time time not null,
  end_time time not null,
  color text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_shift_templates_store_idx
  on public.hr_shift_templates(store_id) where active;
create trigger hr_shift_templates_set_updated_at before update on public.hr_shift_templates
  for each row execute function public.hr_set_updated_at();

-- ---------------------------------------------------------------------------
-- Schedule: one row = one employee's assignment for one day — either a shift
-- (shift_template_id set) or an explicit day off (is_day_off = true). The row's
-- status walks draft → submitted (published to the employee) → acknowledged (HR).
-- ---------------------------------------------------------------------------
create table if not exists public.hr_schedule (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  shift_template_id uuid references public.hr_shift_templates(id) on delete restrict,
  is_day_off boolean not null default false,
  note text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'acknowledged')),
  created_by uuid references public.profiles(id),
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date),
  -- a day off carries no shift; a working day must reference a shift template
  constraint hr_schedule_shift_or_dayoff check (
    (is_day_off = true and shift_template_id is null)
    or (is_day_off = false and shift_template_id is not null)
  )
);
create index if not exists hr_schedule_store_date_idx on public.hr_schedule(store_id, work_date);
create index if not exists hr_schedule_user_date_idx on public.hr_schedule(user_id, work_date);
create trigger hr_schedule_set_updated_at before update on public.hr_schedule
  for each row execute function public.hr_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.hr_shift_templates enable row level security;
alter table public.hr_schedule enable row level security;

-- shift templates: any authenticated user may READ (employees need to resolve the
-- shift times shown on their own schedule); only store managers / HR write.
create policy hr_shift_templates_select on public.hr_shift_templates
  for select to authenticated using (true);
create policy hr_shift_templates_write on public.hr_shift_templates
  for all to authenticated
  using (public.can_manage_store(store_id))
  with check (public.can_manage_store(store_id));

-- schedule: store managers / HR see & write every row of their store; an employee
-- sees only their OWN rows once published (submitted/acknowledged) — drafts stay hidden.
create policy hr_schedule_select on public.hr_schedule
  for select to authenticated
  using (
    public.can_manage_store(store_id)
    or (user_id = (select auth.uid()) and status in ('submitted', 'acknowledged'))
  );
create policy hr_schedule_write on public.hr_schedule
  for all to authenticated
  using (public.can_manage_store(store_id))
  with check (public.can_manage_store(store_id));
