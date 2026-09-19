-- Per-leave-type day counts for the period, stamped on each payslip at generation.
--
-- A leave with no money effect (a paid ลางานศพ that no longer docks travel, or a paid type on a
-- slip with no travel allowance) emitted NO payslip line at all, so HR could not see from the
-- payroll page that the person had been on leave — and could not tell a 2-day ลางานศพ that was
-- correctly left undocked from one that was missed (HR report 2026-09-10). Money lines stay as they
-- are; this is the roll-up the slip prints beside its day count:
--   [{ code, name_th, name_en, days, deduct_salary, deduct_travel, deduct_sc }]
-- Null on slips generated before the column existed.
alter table public.hr_payslips
  add column if not exists leave_summary jsonb;

comment on column public.hr_payslips.leave_summary is
  'Per-leave-type day counts inside the cycle, with the effect flags applied: [{code, name_th, name_en, days, deduct_salary, deduct_travel, deduct_sc}]. Informational; totals come from the lines.';
