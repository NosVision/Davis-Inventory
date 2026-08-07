-- 00181_flag_unclosed_attendance_days.sql
-- Applied to production 2026-08-07.
--
-- Flags the check-INs that never got a check-OUT, so HR's attendance review queue shows them.
--
-- Nothing ever closed the loop on a forgotten check-out: the punch sat with review_status NULL,
-- the derived timesheet went worked_min = null ("cannot be finalised"), and the NEXT day's
-- check-in was accepted as if nothing were wrong. One employee had four days open, the oldest 18
-- days old, none of them flagged (owner report 2026-08-07). From here the check-in route detects
-- and flags them at the moment the employee clocks in again; this catches the existing history.
--
-- Today is excluded — a shift in progress is not a forgotten check-out. The 6-hour offset is the
-- same 06:00 Bangkok business-day cutoff the app uses, so an overnight shift still counts as
-- "yesterday". Rows already carrying a review_status are left alone: no decision HR has made gets
-- reopened. Idempotent.
update public.hr_attendance a
set review_status = 'pending'
where a.type = 'in'
  and a.review_status is null
  and a.business_date < (now() at time zone 'Asia/Bangkok' - interval '6 hours')::date
  and not exists (
    select 1 from public.hr_attendance o
    where o.user_id = a.user_id
      and o.business_date = a.business_date
      and o.type = 'out'
  );
