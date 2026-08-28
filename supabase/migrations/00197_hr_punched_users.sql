-- Pure PUNCH evidence, no roster mixed in. Companion to hr_work_venues (00189), which this cannot
-- replace: hr_work_venues unions a roster row (hr_schedule) with a kept punch (hr_attendance), so it
-- counts a person as "attached" to a venue on the strength of being ROSTERED there alone. That is
-- exactly the evidence a rostered-but-never-punching employee has plenty of — reusing hr_work_venues
-- to ask "has this person ever clocked in" would therefore never answer yes... or rather, never
-- answer no for the one case that matters.
--
-- August 2026: ten back-office staff were rostered every working day and never clocked in once. The
-- roster's own venue-attachment check (built on hr_work_venues) kept listing them as normal — a
-- roster row IS attachment evidence — while the time engine quietly marked ~20 days a month absent
-- for each of them and a draft payslip docked two thirds of a salary. Nothing on any screen said so
-- until the slip was opened (owner report). This function is what lets the roster ask the punch-only
-- question directly: distinct user_id with at least one KEPT 'in' attendance row in the window.
--
-- Same shape and same reasoning as hr_work_venues: returning DISTINCT ids keeps the result bounded
-- (organisation headcount, not headcount × days), so callers never meet PostgREST's silent 1000-row
-- select cap that a raw hr_attendance scan over a 90-day window would risk.
create or replace function hr_punched_user_ids(p_from date, p_to date)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  -- type = 'in' only: time-engine.ts's computeDaySummary derives `firstIn` — and therefore `absent`
  -- — from 'in' punches alone, and this function exists to answer the same question the coverage
  -- route's own absence check asks. Counting out/break punches here would let someone with only
  -- those (no 'in', ever) read as "has punched" while still accumulating real absences — the two
  -- checks would disagree about the one person this function is for.
  select distinct a.user_id
    from hr_attendance a
   where a.business_date between p_from and p_to
     and a.type = 'in'
     and coalesce(a.review_status, '') <> 'rejected'
$$;

-- Server-only, same policy as hr_work_venues: no client should be able to enumerate who has (or has
-- not) ever clocked in.
revoke all on function hr_punched_user_ids(date, date) from public;
revoke all on function hr_punched_user_ids(date, date) from anon;
revoke all on function hr_punched_user_ids(date, date) from authenticated;
grant execute on function hr_punched_user_ids(date, date) to service_role;
