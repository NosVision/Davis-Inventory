-- 00174 — dock the travel allowance for unauthorised absence, not just approved leave.
--
-- Client rule (2026-07-20): ค่าเดินทาง is docked ÷30 × วัน for ลากิจ, ลาป่วย (มีหรือไม่มีใบรับรอง)
-- and ขาดงาน; never for day-off, ลาพักร้อน or วันหยุดนักขัตฤกษ์. The leave side already worked via
-- hr_leave_types.deduct_travel (00169) → the 'travel_leave' line. Absence had NO travel line at all,
-- so a no-show kept their full allowance while someone who honestly filed ลากิจ lost it.
--
-- Adds the 'travel_absent' deduction type the payroll engine now emits. Kept as its own type rather
-- than reusing 'travel_leave' so the slip can label it ขาดงาน and the two stay separable in reports.
--
-- Idempotent (drop-if-exists + re-add). Mirrors 00163's list verbatim plus the new value.

alter table public.hr_payslip_deductions drop constraint if exists hr_payslip_deductions_type_check;
alter table public.hr_payslip_deductions
  add constraint hr_payslip_deductions_type_check
  check (type in (
    'sso','tax','late','absent','leave_unpaid','travel_leave','travel_absent',
    'student_loan','advance','guarantee','loan','provident_fund','other','adjustment'
  ));

-- Service-charge side: absence must dock SC too (same client rule). sc-recompute writes an
-- 'absent'-sourced auto line alongside the existing 'leave' one.
alter table public.hr_sc_deductions drop constraint if exists hr_sc_deductions_source_type_check;
alter table public.hr_sc_deductions
  add constraint hr_sc_deductions_source_type_check
  check (source_type in (
    'warning','warning_carry','leave','absent','late','eval','eval_carry','manual',
    'stock_penalty','stock_penalty_carry'
  ));
