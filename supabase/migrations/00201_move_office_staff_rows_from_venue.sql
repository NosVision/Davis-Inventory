-- 00201: put the office staff's September rows back at the office (owner instruction 2026-09-04).
--
-- Two of the back-office team — HR and a senior accountant — were rostered for the whole of
-- September at 24 BLVD and clocked in there, while the eight colleagues they sit with were rostered
-- at สำนักงาน (OFFICE). The owner confirmed the venue was simply picked wrong on the roster: both
-- work at the office.
--
-- Migration 00200 gave them `work_store_id = OFFICE`, which moves them onto the office's timesheet
-- and roster. Their rows did not follow, and a venue view filters roster and punches by store_id —
-- so without this they would appear on the office's sheet as two empty lines while a month of real
-- hours sat under a venue that no longer lists them. Neither screen would be true.
--
-- Scoped to the affected window and venue rather than a blanket "move everything": the rows before
-- 26 Aug 2026 belong to periods already paid, and no other venue's rows are in question.
--
-- Safe to run twice: the second pass matches nothing (the rows are at OFFICE by then). The moves
-- cannot collide — hr_schedule is unique on (user_id, work_date) with no store in the key, and
-- neither person has an OFFICE row anywhere in this window; hr_attendance has no unique key at all.
-- `hr_schedule.company_id` is NULL on every affected row and `stores` carries no company, so
-- nothing here can leave a row pointing at two entities.

do $$
declare
  office_id uuid := (select id from public.stores where store_code = 'OFFICE');
  venue_id  uuid := (select id from public.stores where store_code = '24');
  moved_roster int;
  moved_punches int;
begin
  if office_id is null or venue_id is null then
    raise notice '00201: OFFICE or 24 not present — nothing to move';
    return;
  end if;

  with target as (
    select profile_id from public.hr_employees where work_store_id = office_id
  )
  update public.hr_schedule sc
  set store_id = office_id
  where sc.store_id = venue_id
    and sc.work_date between date '2026-08-26' and date '2026-09-30'
    and sc.user_id in (select profile_id from target);
  get diagnostics moved_roster = row_count;

  with target as (
    select profile_id from public.hr_employees where work_store_id = office_id
  )
  update public.hr_attendance a
  set store_id = office_id
  where a.store_id = venue_id
    and a.business_date between date '2026-08-26' and date '2026-09-30'
    and a.user_id in (select profile_id from target);
  get diagnostics moved_punches = row_count;

  raise notice '00201: moved % roster rows and % punches to OFFICE', moved_roster, moved_punches;
end $$;
