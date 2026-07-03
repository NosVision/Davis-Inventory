-- 00091_hr_correction_requests.sql
-- P2.4c OT + attendance correction requests (§B/§J8). An employee files a request
-- (ESS); a store approver (manager or HR, via can_manage_store) decides. On approval
-- the app APPLIES the correction: an OT request writes an ot_min override
-- (hr_timesheet_overrides), an attendance request inserts a missing punch or adjusts
-- an existing one's timestamp. No SECURITY DEFINER RPC is needed here (single-table
-- compare-and-set + a plain insert/update from the service client, unlike the swap's
-- two-cell atomic exchange).

create table if not exists public.hr_ot_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  work_date date not null,
  requested_ot_min int not null check (requested_ot_min > 0),
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  decided_ot_min int check (decided_ot_min is null or decided_ot_min >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_ot_requests_store_idx on public.hr_ot_requests(store_id, status);
create index if not exists hr_ot_requests_user_idx on public.hr_ot_requests(user_id);
create unique index if not exists hr_ot_requests_one_open
  on public.hr_ot_requests (user_id, work_date) where status = 'pending';
create trigger hr_ot_requests_set_updated_at before update on public.hr_ot_requests
  for each row execute function public.hr_set_updated_at();

alter table public.hr_ot_requests enable row level security;

create policy hr_ot_requests_select on public.hr_ot_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_store(store_id));
create policy hr_ot_requests_insert on public.hr_ot_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy hr_ot_requests_update on public.hr_ot_requests
  for update to authenticated
  using (public.can_manage_store(store_id) or user_id = (select auth.uid()))
  with check (public.can_manage_store(store_id) or user_id = (select auth.uid()));

create table if not exists public.hr_attendance_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  business_date date not null,
  kind text not null check (kind in ('missing_in', 'missing_out', 'wrong_time', 'other')),
  proposed_type text check (proposed_type in ('in', 'out', 'break_start', 'break_end')),
  proposed_ts timestamptz,
  target_attendance_id uuid references public.hr_attendance(id) on delete set null,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  applied boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_attendance_requests_proposal check (
    (kind in ('missing_in', 'missing_out') and proposed_type is not null and proposed_ts is not null)
    or (kind = 'wrong_time' and target_attendance_id is not null and proposed_ts is not null)
    or (kind = 'other')
  )
);
create index if not exists hr_attendance_requests_store_idx on public.hr_attendance_requests(store_id, status);
create index if not exists hr_attendance_requests_user_idx on public.hr_attendance_requests(user_id);
create unique index if not exists hr_attendance_requests_one_open
  on public.hr_attendance_requests (user_id, business_date) where status = 'pending';
create trigger hr_attendance_requests_set_updated_at before update on public.hr_attendance_requests
  for each row execute function public.hr_set_updated_at();

alter table public.hr_attendance_requests enable row level security;

create policy hr_attendance_requests_select on public.hr_attendance_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_store(store_id));
create policy hr_attendance_requests_insert on public.hr_attendance_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy hr_attendance_requests_update on public.hr_attendance_requests
  for update to authenticated
  using (public.can_manage_store(store_id) or user_id = (select auth.uid()))
  with check (public.can_manage_store(store_id) or user_id = (select auth.uid()));
