-- 00162: recurring payroll items v2 — period windows + code whitelist (payroll redesign 2026-07-14).
--
-- start_period / end_period are 'YYYY-MM' strings matching hr_payruns (period_year, period_month):
--   * start_period null → applies since forever
--   * end_period   null → PERPETUAL (never expires)
--   * both set     → applies for payrun periods start..end inclusive
-- Text compare works because both sides are zero-padded 'YYYY-MM'. Expiry is now data the generate
-- filter enforces — no human has to remember to delete a row before running a payrun.
--
-- The code whitelist closes the free-text hole in 00105 (code had no CHECK). Safe: the table has
-- zero rows in production as of this migration.

alter table hr_employee_recurring
  add column start_period text,
  add column end_period text;

alter table hr_employee_recurring
  add constraint hr_employee_recurring_start_period_fmt
    check (start_period is null or start_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  add constraint hr_employee_recurring_end_period_fmt
    check (end_period is null or end_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  add constraint hr_employee_recurring_period_order
    check (start_period is null or end_period is null or end_period >= start_period),
  add constraint hr_employee_recurring_code_whitelist
    check (code in ('cost_of_living','housing','phone','travel','holiday_comp',
                    'student_loan','advance','guarantee','loan','other'));

comment on column hr_employee_recurring.start_period is 'First payrun period (YYYY-MM) the item applies to; null = since forever';
comment on column hr_employee_recurring.end_period is 'Last payrun period (YYYY-MM) the item applies to, inclusive; null = perpetual';
