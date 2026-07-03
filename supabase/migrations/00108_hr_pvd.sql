-- P4.4: Provident Fund (กองทุนสำรองเลี้ยงชีพ / PVD) per-employee config.
-- Employee contributes pvd_employee_rate × base salary each month → a payslip deduction that
-- reduces net pay. Employer matches at pvd_employer_rate (shown for reporting; does NOT reduce
-- the employee's net). The employee's PVD contribution is also tax-deductible (ล.ย.01), so the
-- payrun assembler adds the annualized employee PVD to the progressive-tax allowance base
-- (on top of any hr_tax_allowances rows). Rates are fractions (0.03 = 3%); Thai PVD is 2–15%.

alter table public.hr_employees
  add column if not exists pvd_enrolled boolean not null default false,
  add column if not exists pvd_employee_rate numeric(5,4) not null default 0
    check (pvd_employee_rate >= 0 and pvd_employee_rate <= 0.15),
  add column if not exists pvd_employer_rate numeric(5,4) not null default 0
    check (pvd_employer_rate >= 0 and pvd_employer_rate <= 0.15);
