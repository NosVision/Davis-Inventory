-- 00173_attendance_reminder_cron.sql
-- Registers the MISSING pg_cron schedule for the attendance check-in/out reminder job.
-- 00142 shipped the de-dup ledger + the GET /api/cron/attendance-reminder route, and 00143 seeded the
-- 'attendance_reminder' bearer secret — but no migration ever scheduled the job, so the reminder never
-- fired on its own (config drift). This wires it up: Supabase pg_cron pings the endpoint every 30 min
-- (Vercel Hobby can't do sub-daily crons). Same Supabase-managed-secret pattern as 00157, so no Vercel
-- env var is required. pg_cron runs in UTC; '*/30 * * * *' fires on every :00/:30 (tz-agnostic half-hours),
-- and the route itself resolves the Bangkok business date + shift bounds.

-- Shared bearer secret (idempotent). Already seeded in 00143 — this NEVER overwrites the existing row,
-- so the cron job and the endpoint keep reading the same secret.
insert into public.cron_secrets (name, secret)
select 'attendance_reminder', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
where not exists (select 1 from public.cron_secrets where name = 'attendance_reminder');

-- Every-30-min job (cron.schedule upserts by name → safe to re-run).
select cron.schedule(
  'attendance-reminder',
  '*/30 * * * *',
  $cmd$
    select net.http_get(
      url := 'https://davis-inventory.vercel.app/api/cron/attendance-reminder',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select secret from public.cron_secrets where name = 'attendance_reminder')
      )
    );
  $cmd$
);
