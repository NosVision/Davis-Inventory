-- notifications: retention job + the indexes the clients actually query by.
--
-- The table reached 645,090 rows / 243 MB on 2026-09-19 (truncated that day, owner ask) from
-- 3,652 deposits: every venue event was written once per user_stores member, and nothing ever
-- deleted a row. The bell reads `user_id order by created_at desc limit 50`
-- (src/hooks/use-notifications.ts) and counts `user_id and read = false`; neither had a matching
-- index. Fan-out is narrowed in code (src/lib/notifications/recipients.ts); this migration keeps
-- the table from growing without bound and makes the two hot reads index scans.

-- 1. Indexes matching the client reads.
create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, created_at desc)
  where read = false;

-- 2. Retention. Same pattern as 00157 (hr-close-reminder): a named cron.schedule is an upsert,
--    so re-running this file only replaces the job. Runs 03:10 Bangkok = 20:10 UTC, after the
--    daily HR jobs and before opening hours.
--
--    read      + older than 30 days  → gone (informational: new_deposit, deposit_confirmed, chat)
--    unread    + older than 90 days  → gone
--    action types (approvals, withdrawals, hr_*) are kept 180 days whatever their read state, so
--    an audit of "who was told" still has them for two payroll cycles.
create or replace function public.notifications_retention()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer := 0;
  n integer;
begin
  delete from public.notifications
  where created_at < now() - interval '180 days';
  get diagnostics n = row_count; removed := removed + n;

  delete from public.notifications
  where created_at < now() - interval '90 days'
    and type not in ('approval_request', 'withdrawal_request')
    and type not like 'hr\_%';
  get diagnostics n = row_count; removed := removed + n;

  delete from public.notifications
  where read = true
    and created_at < now() - interval '30 days'
    and type not in ('approval_request', 'withdrawal_request')
    and type not like 'hr\_%';
  get diagnostics n = row_count; removed := removed + n;

  return removed;
end;
$$;

revoke all on function public.notifications_retention() from public;

comment on function public.notifications_retention is
  'Daily notification retention: 30 d for read informational rows, 90 d for unread informational rows, 180 d for approval/withdrawal/hr_* rows. Returns rows removed. Scheduled by pg_cron as notifications-retention.';

select cron.schedule(
  'notifications-retention',
  '10 20 * * *',
  $cmd$ select public.notifications_retention(); $cmd$
);
