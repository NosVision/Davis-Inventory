-- Allow a 'warning_carry' service-charge deduction line — the auto-applied 2nd (+) month of a
-- multi-cycle disciplinary warning (deduct_200 = 2 months of SC; a large amount_baht penalty can
-- span more). The recompute route reads the PRIOR month's warning carry_satang and lays down a
-- 'warning_carry' line in the new month so "2 months" actually docks two months instead of one.
-- (Previously carry_satang was recorded on month 1 for visibility only and never consumed.)

alter table public.hr_sc_deductions drop constraint if exists hr_sc_deductions_source_type_check;
alter table public.hr_sc_deductions
  add constraint hr_sc_deductions_source_type_check
  check (source_type in ('warning', 'warning_carry', 'leave', 'late', 'eval', 'manual'));
