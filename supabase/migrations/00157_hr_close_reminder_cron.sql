-- 00157_hr_close_reminder_cron.sql
-- Date-based monthly-close reminders for HR. A single daily pg_cron job hits
-- /api/cron/hr-close-reminder, which decides from the day-of-month what (if anything) to remind
-- about (SV close 13-14, payroll 26, finalize 30, eval cutoff 10). Uses the same Supabase-managed
-- secret pattern as the attendance reminder, so no Vercel env var is required. pg_cron runs in UTC:
-- 02:00 UTC ≈ 09:00 Asia/Bangkok.

-- Shared bearer secret (idempotent).
insert into public.cron_secrets (name, secret)
select 'hr_close_reminder', gen_random_uuid()::text
where not exists (select 1 from public.cron_secrets where name = 'hr_close_reminder');

-- Daily job (cron.schedule upserts by name).
select cron.schedule(
  'hr-close-reminder',
  '0 2 * * *',
  $cmd$
    select net.http_get(
      url := 'https://davis-inventory.vercel.app/api/cron/hr-close-reminder',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select secret from public.cron_secrets where name = 'hr_close_reminder')
      )
    );
  $cmd$
);
