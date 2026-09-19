-- 20260919100000_hr_employees_pay_column_grants.sql
-- Column-level SELECT on hr_employees: the pay columns are no longer readable through PostgREST
-- by an ordinary HR JWT (client: คุณต๊ะ/คุณเมย์ 2026-08-11, 2026-09-11/14/16 — HR #2 must not see
-- ทีมบัญชี's pay ANYWHERE).
--
-- Why a grant and not a policy: RLS is row-level. The SELECT policy on hr_employees is
-- can_manage_hr() (00078) and has to stay that way — a hidden employee must remain fully visible
-- for leave, scheduling, attendance and documents ("hide the NUMBERS, not the PERSON", 00182/00195).
-- The app enforces the column rule in TypeScript (src/lib/hr/pay-visibility.ts, redactEmployeePay)
-- on every server route, but every server route reads through the service role; the same HR user
-- could open the REST endpoint with their own JWT and read every salary raw. Postgres column
-- privileges close that door at the table, where no route can forget it.
--
-- What keeps working:
--   * Server routes: createServiceClient() — service_role keeps full SELECT, redaction stays in TS.
--   * Browser reads (audited 2026-09-19): the only client-side query on hr_employees is
--     users-manager.tsx, selecting id, profile_id, full_name, status, end_date. No `select *`, no
--     PostgREST embed into hr_employees from a browser client anywhere in src/.
--   * Policies that read hr_employees as the caller (hr_audit_log_select, 00195) touch only
--     id / profile_id / pay_confidential / payroll_group_id — all still granted.
--   * pay_hidden_profile_ids() / pay_hidden_from_caller() are SECURITY DEFINER (00195).
--   * The one trigger on the table (hr_set_updated_at) touches updated_at only.
--   * INSERT / UPDATE / DELETE grants for authenticated are untouched (still whole-table; RLS
--     hr_employees_write = can_manage_hr() decides who may use them).
-- Anything that later selects `*` from hr_employees with a user JWT will fail with
-- "permission denied for table hr_employees" — that is the intended signal, not a regression.
--
-- The pay column list below is the SQL twin of EMPLOYEE_PAY_COLUMNS in
-- src/lib/hr/pay-visibility.ts; scripts/test-pay-visibility.cjs parses this file and fails when the
-- two drift. Change one, change both.
--
-- PAY_COLUMNS: rate_satang, bank_name, bank_account_no, bank_account_name, bank_verified,
-- PAY_COLUMNS: bank_verified_at, bank_verified_by, sso_no, tax_id, tax_mode, pvd_enrolled,
-- PAY_COLUMNS: pvd_employee_rate, pvd_employer_rate
--
-- Rollback (restores the pre-2026-09-19 whole-table read):
--   grant select on public.hr_employees to authenticated;

revoke select on public.hr_employees from authenticated;

-- Every column of hr_employees as of 2026-09-19 (45) minus the 13 pay columns above.
grant select (
  id,
  profile_id,
  company_id,
  position_id,
  department_id,
  supervisor_id,
  employee_code,
  pay_type,
  work_hours_per_day,
  break_hours,
  ot_eligible,
  ot_hour_divisor,
  standard_days_off,
  sso_enrolled,
  emergency_contact,
  documents,
  start_date,
  probation_end,
  status,
  end_date,
  end_reason,
  notes,
  created_at,
  updated_at,
  created_by,
  updated_by,
  birth_date,
  paper_slip_standing,
  full_name,
  pay_confidential,
  payroll_group_id,
  work_store_id
) on public.hr_employees to authenticated;

comment on table public.hr_employees is
  'Employee master. SELECT for authenticated is column-level since 2026-09-19: the pay columns (rate, bank, SSO/tax ids, tax mode, PVD, bank verification) are not granted — read them through hr_employees_pay (nulled per pay_hidden_from_caller) or a service-role route that redacts. A new column that carries pay must NOT be added to the grant list; a new non-pay column must be, or the browser cannot read it.';
