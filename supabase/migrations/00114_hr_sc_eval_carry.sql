-- Allow an 'eval_carry' service-charge deduction line — the carried-over overflow of an
-- evaluation SC deduction (apply-sc source_type='eval') that exceeded one month's allocation.
-- Mirrors 'warning_carry' (00113). The SC recompute reads prior 'eval'/'eval_carry' carry and
-- lays down an 'eval_carry' line so an eval penalty larger than a month's SC keeps docking the
-- next month instead of being silently dropped.

alter table public.hr_sc_deductions drop constraint if exists hr_sc_deductions_source_type_check;
alter table public.hr_sc_deductions
  add constraint hr_sc_deductions_source_type_check
  check (source_type in ('warning', 'warning_carry', 'leave', 'late', 'eval', 'eval_carry', 'manual'));
