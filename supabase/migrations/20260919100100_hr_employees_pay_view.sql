-- 20260919100100_hr_employees_pay_view.sql
-- hr_employees_pay: the pay columns of hr_employees, nulled per caller by the visibility rule.
--
-- 20260919100000 took the pay columns away from `authenticated` at the table. This is the way
-- back in for a user JWT: one row per employee, the money present only when
-- pay_hidden_from_caller(pay_confidential, payroll_group_id) says the caller may see it, and a
-- `pay_hidden` flag so a screen can say "ปิดข้อมูล" rather than mistake null for empty.
-- Same rule as redactEmployeePay in src/lib/hr/pay-visibility.ts (EMPLOYEE_PAY_COLUMNS).
--
-- NOT security_invoker, on purpose. A security-invoker view checks the underlying table's
-- privileges as the caller, and the caller no longer holds SELECT on these columns — the view
-- would answer "permission denied" for exactly the user it exists for. So it runs as its owner
-- (postgres), which bypasses both the column grant and RLS on hr_employees; the two things RLS
-- gave us are put back by hand:
--   * the row gate:  `where public.can_manage_hr()` — the same predicate as hr_employees_select;
--   * the pay gate:  pay_hidden_from_caller() per row, evaluated for auth.uid() of the caller
--                    (it is SECURITY DEFINER and reads the JWT setting, so it is the caller's
--                    answer even though the view body runs as postgres).
-- security_barrier stops a leaky user function from being pushed below the gate.
--
-- Rollback: drop view if exists public.hr_employees_pay;

create or replace view public.hr_employees_pay
with (security_barrier = true, security_invoker = false)
as
select
  e.id,
  e.profile_id,
  h.hidden                                                 as pay_hidden,
  case when h.hidden then null else e.rate_satang       end as rate_satang,
  case when h.hidden then null else e.bank_name         end as bank_name,
  case when h.hidden then null else e.bank_account_no   end as bank_account_no,
  case when h.hidden then null else e.bank_account_name end as bank_account_name,
  case when h.hidden then null else e.bank_verified     end as bank_verified,
  case when h.hidden then null else e.bank_verified_at  end as bank_verified_at,
  case when h.hidden then null else e.bank_verified_by  end as bank_verified_by,
  case when h.hidden then null else e.sso_no            end as sso_no,
  case when h.hidden then null else e.tax_id            end as tax_id,
  case when h.hidden then null else e.tax_mode          end as tax_mode,
  case when h.hidden then null else e.pvd_enrolled      end as pvd_enrolled,
  case when h.hidden then null else e.pvd_employee_rate end as pvd_employee_rate,
  case when h.hidden then null else e.pvd_employer_rate end as pvd_employer_rate
from public.hr_employees e
cross join lateral (
  select public.pay_hidden_from_caller(e.pay_confidential, e.payroll_group_id) as hidden
) h
where public.can_manage_hr();

comment on view public.hr_employees_pay is
  'Pay columns of hr_employees for a user JWT: null (and pay_hidden = true) when pay_hidden_from_caller() hides this employee from the caller. Rows limited to can_manage_hr(), mirroring hr_employees_select. Runs as owner because the caller holds no SELECT on these columns at the table (20260919100000).';

revoke all on public.hr_employees_pay from anon;
revoke all on public.hr_employees_pay from public;
grant select on public.hr_employees_pay to authenticated;
grant select on public.hr_employees_pay to service_role;
