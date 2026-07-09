-- 00149_hr_sc_stock_penalty.sql
-- Allow stock penalties to be deducted from Service Charge with carry-forward (owner ask 2026-07-09).
-- Same source_type CHECK extension pattern as 00113 (warning_carry) / 00114 (eval_carry).
-- Applied by POST /api/hr/service-charge/apply-stock-penalties ('stock_penalty'); carry to the
-- next month is produced by the SC recompute route ('stock_penalty_carry' family).
alter table public.hr_sc_deductions drop constraint if exists hr_sc_deductions_source_type_check;
alter table public.hr_sc_deductions
  add constraint hr_sc_deductions_source_type_check
  check (source_type in (
    'warning', 'warning_carry', 'leave', 'late', 'eval', 'eval_carry', 'manual',
    'stock_penalty', 'stock_penalty_carry'
  ));
