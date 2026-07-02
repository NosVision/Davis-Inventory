-- 00082_hr_announcements.sql
-- P1.3: store-scoped announcements (feature #2) with acknowledge receipts.
-- "ไม่รับทราบ→เด้งซ้ำวันถัดไป": an unacknowledged announcement that a staff member snoozes
-- (dismisses without acknowledging) re-appears on the next business day (Bangkok 6am cutoff).

create table if not exists public.hr_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id)
);
create trigger hr_announcements_set_updated_at before update on public.hr_announcements
  for each row execute function public.hr_set_updated_at();

-- scope: no rows for an announcement = company-wide (all stores); rows = only those stores.
create table if not exists public.hr_announcement_stores (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.hr_announcements(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  unique (announcement_id, store_id)
);
create index if not exists hr_announcement_stores_ann_idx on public.hr_announcement_stores(announcement_id);
create index if not exists hr_announcement_stores_store_idx on public.hr_announcement_stores(store_id);

-- one receipt per (announcement, user). acknowledged_at set on ack; snoozed_date set on "later".
create table if not exists public.hr_announcement_receipts (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.hr_announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  acknowledged_at timestamptz,
  snoozed_date date,                   -- business date it was dismissed → hidden that day only
  updated_at timestamptz not null default now(),
  unique (announcement_id, user_id)
);
create trigger hr_announcement_receipts_set_updated_at before update on public.hr_announcement_receipts
  for each row execute function public.hr_set_updated_at();
create index if not exists hr_announcement_receipts_user_idx on public.hr_announcement_receipts(user_id);

alter table public.hr_announcements enable row level security;
alter table public.hr_announcement_stores enable row level security;
alter table public.hr_announcement_receipts enable row level security;

create policy hr_announcements_select on public.hr_announcements
  for select to authenticated using (active = true or public.can_manage_hr());
create policy hr_announcements_write on public.hr_announcements
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());

create policy hr_announcement_stores_select on public.hr_announcement_stores
  for select to authenticated using (true);
create policy hr_announcement_stores_write on public.hr_announcement_stores
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());

create policy hr_announcement_receipts_select on public.hr_announcement_receipts
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_hr());
create policy hr_announcement_receipts_write on public.hr_announcement_receipts
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
