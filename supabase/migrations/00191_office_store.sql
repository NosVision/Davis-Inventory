-- An office venue, so the people who work in one can be rostered like everyone else.
--
-- Attendance and the roster are keyed on a store, which left the accounting, HR and purchasing
-- staff with nowhere to belong: their punches resolved to no venue at all, so they were invisible
-- on every venue timesheet while payroll still charged their lateness (owner report 2026-08-17).
-- The existing HQ store is the stock module's central warehouse (is_central), not a place people
-- work a shift, so conflating the two would repeat exactly the mistake this fixes.
--
-- No geofence is set here on purpose — HR enters the office coordinates at /hr/locations, and
-- until they do, a punch from an office employee resolves to this store by sole-assignment rather
-- than by position.
insert into stores (store_code, store_name, active, is_central)
select 'OFFICE', 'สำนักงาน (Office)', true, false
where not exists (select 1 from stores where store_code = 'OFFICE');

-- Everyone currently employed with no venue at all moves in. Restricted to people who have NO
-- membership anywhere: someone already attached to a venue has a place, and adding a second one
-- would put them back in the multi-venue ambiguity this is meant to end.
insert into user_stores (user_id, store_id)
select e.profile_id, (select id from stores where store_code = 'OFFICE')
from hr_employees e
left join profiles pr on pr.id = e.profile_id
where e.status in ('active', 'probation')
  and coalesce(pr.is_system, false) = false
  and e.profile_id is not null
  and not exists (select 1 from user_stores us where us.user_id = e.profile_id)
on conflict do nothing;
