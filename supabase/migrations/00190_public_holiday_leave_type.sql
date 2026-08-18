-- Retire the public-holiday calendar; add the leave type that replaces it.
--
-- `hr_holidays` tried to say "this date is not a working day", but the group runs venues that
-- trade every day alongside an office that does not, and the table is keyed on COMPANY — while one
-- company (ทรัพย์สินตระการตา) holds both its bar staff and its accounting team. It could therefore
-- never be right for both: the office was docked for a holiday it did take, and a bar shift rostered
-- on a holiday could be skipped with no absence recorded (owner report 2026-08-18).
--
-- The roster already records exactly what the calendar was guessing, per person and per day, so it
-- becomes the only source of "was this a working day". Every code path that consulted hr_holidays
-- was removed in the same change; the table and its rows are left in place, unread, rather than
-- dropped, so the historical record of what was declared stays recoverable.
--
-- What replaces it for the employee: a leave type that costs them nothing. Someone who wants a
-- public holiday off files ลาวันหยุดนักขัตฤกษ์; approving it deducts no salary, no service charge
-- and no travel allowance. That keeps the decision on the record — who took which holiday, approved
-- by whom — which the calendar never did.
insert into hr_leave_types (company_id, code, name_th, name_en, paid, paid_with_cert, deduct_sc, deduct_travel, requires_cert, active, sort_order)
select c.id, 'public_holiday', 'ลาวันหยุดนักขัตฤกษ์', 'Public holiday leave',
       true,   -- paid: no salary deduction
       false,  -- no certificate involved
       false,  -- does not dock Service Charge
       false,  -- does not dock the travel allowance
       false,
       true,
       coalesce((select max(sort_order) from hr_leave_types t2 where t2.company_id = c.id), 0) + 1
from hr_companies c
where not exists (
  select 1 from hr_leave_types t where t.company_id = c.id and t.code = 'public_holiday'
);
