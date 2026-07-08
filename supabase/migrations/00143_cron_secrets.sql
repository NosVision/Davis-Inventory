-- 00143_cron_secrets.sql
-- Supabase-managed secrets for pg_cron-triggered endpoints (owner ask 2026-07-08), so scheduled
-- jobs can authenticate WITHOUT editing Vercel env vars. RLS-locked: only the service role (which
-- bypasses RLS) reads it from the app; DB admins manage rows in the SQL editor. The cron job and the
-- endpoint read the SAME row, so the secret never leaves Supabase.
create table if not exists public.cron_secrets (
  name text primary key,
  secret text not null,
  created_at timestamptz not null default now()
);
alter table public.cron_secrets enable row level security;
-- (no policies → no client/anon access; service role bypasses RLS)

insert into public.cron_secrets (name, secret)
values ('attendance_reminder', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;
