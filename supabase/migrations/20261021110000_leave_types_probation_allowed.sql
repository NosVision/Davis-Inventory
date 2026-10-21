-- 20261021110000_leave_types_probation_allowed.sql
-- Probation staff may take any leave; whether it is granted is the supervisor's approval call
-- (HR decision 2026-10-21). Until now vacation, public-holiday and maternity leave were refused
-- outright for anyone within probation_end, in every company.
--
-- Every type is opened, inactive ones included, so re-activating a type later does not bring the
-- block back. The column default flips too, so a type created later starts allowed. The per-type
-- switch stays (leave-types page) for HR to close a type again on purpose.

update public.hr_leave_types
   set probational_allowed = true
 where probational_allowed = false;

alter table public.hr_leave_types
  alter column probational_allowed set default true;
