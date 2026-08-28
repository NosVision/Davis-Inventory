-- Bounded-shape companions to hr_punched_user_ids (00197) for two more client queries that scan
-- hr_schedule / hr_attendance across (people × days) and risk PostgREST's silent 1000-row select
-- cap — the same hazard this file's siblings already guard against (see hr_work_venues's and
-- hr_punched_user_ids' own comments). Both were found in the FINAL whole-branch review for
-- payroll-command-center (2026-08-28), after the branch had already fixed the identical shape once
-- (00197) but reintroduced it twice more:
--
-- (a) absence-summary.ts's per-slice coverage-panel query (`loadUnauthorizedAbsentDays`):
--     `hr_schedule` and `hr_attendance` for a whole payroll slice over a whole cycle. 32 rostered
--     people × 31 days = 992 rows already saturates the cap; production runs 131 staff. Past the
--     cap, rows silently fall off the end and the people who lose their schedule/attendance rows
--     read as unscheduled → 0 absent days, so the heavy-absence warning this file exists to raise
--     silently omits exactly the people it was built to catch.
--
-- (b) copy-month's skip-set query (`src/app/api/hr/schedule/copy-month/route.ts`): one row per
--     person per day in the target month, no store filter, no limit. Past the cap the skip set is
--     arbitrary, the plan then inserts cells for people who already hold a row, and the resulting
--     23505 makes the route 409 and insert NOTHING — the "safe to press twice" promise in its own
--     comment stops being true.
--
-- All three keep the row count bounded by HEADCOUNT rather than headcount × days. (a) does this by
-- returning one row per user with that user's days folded into a JSON array, so
-- `loadUnauthorizedAbsentDays` can still reduce the SAME per-day fields `countUnauthorizedAbsentDays`
-- already reduces, rather than reimplementing absence logic a third time in SQL — see
-- absence-summary.ts's own "NOTE ON DUPLICATION" for why that duplication is deliberate and must
-- not grow a third copy. (b) is the same DISTINCT-ids shape as hr_punched_user_ids.

-- (a1) hr_schedule_for_members: one row per user_id in p_user_ids, with that user's schedule cells
-- for the window as a JSON array.
create or replace function hr_schedule_for_members(p_user_ids uuid[], p_from date, p_to date)
returns table (user_id uuid, cells jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id,
         jsonb_agg(
           jsonb_build_object(
             'work_date', s.work_date,
             'is_day_off', s.is_day_off,
             'start_time', t.start_time,
             'end_time', t.end_time
           )
         ) as cells
    from hr_schedule s
    left join hr_shift_templates t on t.id = s.shift_template_id
   where s.user_id = any(p_user_ids)
     and s.work_date between p_from and p_to
   group by s.user_id
$$;

revoke all on function hr_schedule_for_members(uuid[], date, date) from public;
revoke all on function hr_schedule_for_members(uuid[], date, date) from anon;
revoke all on function hr_schedule_for_members(uuid[], date, date) from authenticated;
grant execute on function hr_schedule_for_members(uuid[], date, date) to service_role;

-- (a2) hr_attendance_for_members: one row per user_id with the DISTINCT business_dates they have a
-- KEPT 'in' punch on. Mirrors hr_punched_user_ids' (00197) type/review_status filter exactly — this
-- must agree with that function about what counts as "punched", or the two checks would disagree
-- about the same person.
create or replace function hr_attendance_for_members(p_user_ids uuid[], p_from date, p_to date)
returns table (user_id uuid, punched_dates jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id,
         jsonb_agg(distinct a.business_date) as punched_dates
    from hr_attendance a
   where a.user_id = any(p_user_ids)
     and a.business_date between p_from and p_to
     and a.type = 'in'
     and coalesce(a.review_status, '') <> 'rejected'
   group by a.user_id
$$;

revoke all on function hr_attendance_for_members(uuid[], date, date) from public;
revoke all on function hr_attendance_for_members(uuid[], date, date) from anon;
revoke all on function hr_attendance_for_members(uuid[], date, date) from authenticated;
grant execute on function hr_attendance_for_members(uuid[], date, date) to service_role;

-- (b) hr_scheduled_user_ids: distinct user_ids that already hold ANY hr_schedule row in the date
-- range, at ANY store — copy-month's skip-set check is deliberately store-agnostic (hr_schedule is
-- unique on (user_id, work_date) regardless of store), which is exactly why the flat client query
-- had no store filter to bound it by. DISTINCT ids bounds this the same way hr_punched_user_ids
-- bounds punch evidence: by headcount, not headcount × days.
create or replace function hr_scheduled_user_ids(p_from date, p_to date)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct s.user_id
    from hr_schedule s
   where s.work_date between p_from and p_to
$$;

revoke all on function hr_scheduled_user_ids(date, date) from public;
revoke all on function hr_scheduled_user_ids(date, date) from anon;
revoke all on function hr_scheduled_user_ids(date, date) from authenticated;
grant execute on function hr_scheduled_user_ids(date, date) to service_role;
