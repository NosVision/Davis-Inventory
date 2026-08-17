-- Which venues a person actually WORKED in a window — as opposed to which venues they can SEE.
--
-- `user_stores` predates HR. It came from the liquor-deposit module, where a row means "this person
-- oversees this venue's data"; HR then read the same table as "this person works at this venue",
-- which is a different claim. An HR/accounting user overseeing five venues therefore appeared on
-- five venues' timesheets and rosters and was counted in five venues' payroll breakdowns, despite
-- never having taken a shift at four of them (owner report 2026-08-17). The table cannot tell the
-- two apart: it is exactly (user_id, store_id) and carries no role or primary flag.
--
-- So work is evidenced rather than declared: a roster row or a kept punch AT that venue inside the
-- window being viewed. Rejected punches are excluded — the timesheet and payroll already refuse to
-- pay them, so they are not evidence of having worked there either.
--
-- Returning DISTINCT pairs keeps the result bounded by (staff × venues) — a few hundred rows — so
-- callers never meet PostgREST's silent 1000-row select cap, which a raw hr_schedule scan over a
-- month (127 staff × 31 days) would sail straight past.
create or replace function hr_work_venues(p_from date, p_to date)
returns table (user_id uuid, store_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct s.user_id, s.store_id
    from hr_schedule s
   where s.work_date between p_from and p_to
     and s.store_id is not null
  union
  select distinct a.user_id, a.store_id
    from hr_attendance a
   where a.business_date between p_from and p_to
     and a.store_id is not null
     and coalesce(a.review_status, '') <> 'rejected'
$$;

-- Server-only. Every caller is a service-role HR route; no client should be able to enumerate who
-- worked where, so the PUBLIC grant a new function is created with is withdrawn explicitly.
revoke all on function hr_work_venues(date, date) from public;
revoke all on function hr_work_venues(date, date) from anon;
revoke all on function hr_work_venues(date, date) from authenticated;
grant execute on function hr_work_venues(date, date) to service_role;
