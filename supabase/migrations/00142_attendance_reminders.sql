-- 00142_attendance_reminders.sql
-- De-dup ledger for the attendance check-in/out reminder job (owner ask 2026-07-08): at most one
-- reminder per employee per business date per kind, so the 30-min cron never spams. The reminder
-- LOGIC lives in /api/hr/cron/attendance-reminder (reuses notifyUser → in-app + PWA push + LINE);
-- Supabase pg_cron pings that endpoint every 30 min (Vercel Hobby can't do sub-daily crons).
create table if not exists public.hr_attendance_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  business_date date not null,
  kind text not null check (kind in ('checkin', 'checkout')),
  sent_at timestamptz not null default now(),
  unique (user_id, business_date, kind)
);

alter table public.hr_attendance_reminders enable row level security;

-- Server writes via the service role; HR may read for auditing. No employee-facing access needed.
create policy hr_attendance_reminders_hr_read on public.hr_attendance_reminders
  for select to authenticated using (public.can_manage_hr());
