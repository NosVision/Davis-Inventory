-- 20261005100000_hr_employees_late_exempt.sql
-- Per-person "ไม่หักสาย" (HR ask 2026-10-05): managers whose hours are flexible were fined for
-- lateness from the first minute, and the only ways around it were a hand edit on every day or a
-- roster deliberately set later than the real shift (which corrupts hours, OT and absence).
--
-- When true, payroll charges no late fine and the attendance index takes no lateness penalty.
-- Late MINUTES are still computed and shown on the timesheet — the punch record stays honest.
--
-- Not a pay column, so it joins the column-level SELECT grant (20260919100000).

alter table public.hr_employees
  add column if not exists late_exempt boolean not null default false;

comment on column public.hr_employees.late_exempt is
  'No late fine and no attendance-index lateness penalty for this person. Late minutes still recorded.';

grant select (late_exempt) on public.hr_employees to authenticated;
