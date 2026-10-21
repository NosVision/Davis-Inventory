-- 20261021100000_hr_schedule_locks.sql
-- HR roster lock (HR ask 2026-10-21): once a venue's supervisors have built a month's roster, HR
-- locks that store's month so nobody keeps editing it until HR opens it again.
--
-- One row = that store's month is locked; unlocking deletes the row (who/when is kept in
-- hr_audit_log). While locked, store managers / captains get 409 on every roster write path
-- (single cell, batch, clear, copy-month). Company-wide HR still edits, and an approved day-off
-- swap still moves the cells; both were the owner's call.
--
-- Written only by server routes holding the service-role client, so there is no write policy.

create table if not exists public.hr_schedule_locks (
  store_id uuid not null references public.stores(id) on delete cascade,
  -- first day of the locked month (YYYY-MM-01)
  month date not null check (extract(day from month) = 1),
  locked_by uuid references public.profiles(id) on delete set null,
  locked_at timestamptz not null default now(),
  primary key (store_id, month)
);

comment on table public.hr_schedule_locks is
  'A store''s monthly roster locked by HR: managers cannot edit it until HR unlocks (row deleted).';

alter table public.hr_schedule_locks enable row level security;

create policy hr_schedule_locks_select on public.hr_schedule_locks
  for select to authenticated
  using (public.can_manage_store(store_id));
