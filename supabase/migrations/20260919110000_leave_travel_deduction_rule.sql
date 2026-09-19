-- Travel allowance is docked for EVERY leave day except ลาพักร้อน and ลาวันหยุดนักขัตฤกษ์
-- (client rule 2026-07-20: dayoff / annual leave / public holiday → no travel deduction; sick with
-- or without a certificate / personal / absent / anything else → ค่าเดินทาง ÷ 30 per day).
--
-- The 00169 backfill derived deduct_travel from `NOT paid`, so every PAID special type
-- (bereavement, maternity, marriage, training, special, health_check) came out deduct_travel=false
-- and its days were never docked. HR's September 2026 report (2026-09-10): a 2-day ลางานศพ paid
-- the full travel allowance. Salary docking is untouched (it follows paid / paid_with_cert);
-- deduct_sc is untouched — the SC rule was never part of this report.
update public.hr_leave_types
   set deduct_travel = true
 where code not in ('vacation', 'public_holiday')
   and deduct_travel = false;
