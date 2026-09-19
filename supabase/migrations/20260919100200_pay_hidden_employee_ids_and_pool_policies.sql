-- 20260919100200_pay_hidden_employee_ids_and_pool_policies.sql
-- Carry the pay-visibility predicate (00195) to the tables that still read as bare can_manage_hr():
-- service-charge and tip allocations/deductions (00103, 00109) and the imported legacy payslips
-- (00130). The app already applies the rule on their routes (memory: "SC/tip pools + history/
-- imported slips follow the payrun rule, 2026-09-13"); the tables themselves still handed every
-- HR JWT every amount through PostgREST. hr_payruns stays open (totals, not a person's figure).
--
-- Rollback: re-run the CREATE POLICY blocks of 00103 (hr_sc_allocations_read,
-- hr_sc_deductions_read), 00109 (hr_tip_allocations_read, hr_tip_deductions_read) and 00130
-- (hr_imported_payslips_hr_all), then `drop function public.pay_hidden_employee_ids()`.

-- ---------------------------------------------------------------------------
-- hr_employees.id of every employee whose pay is hidden from the caller — the employee-keyed
-- twin of pay_hidden_profile_ids() (00195), for tables keyed by the employee row rather than the
-- login. Mirrors payHiddenEmployeeIds in src/lib/hr/pay-visibility.ts.
-- ---------------------------------------------------------------------------
create or replace function public.pay_hidden_employee_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
  from public.hr_employees e
  where public.pay_hidden_from_caller(e.pay_confidential, e.payroll_group_id);
$$;

comment on function public.pay_hidden_employee_ids is
  'hr_employees.id of every employee whose pay figures are hidden from the calling user. Empty for can_view_confidential_pay() holders. Employee-keyed twin of pay_hidden_profile_ids().';

revoke all on function public.pay_hidden_employee_ids() from public;
grant execute on function public.pay_hidden_employee_ids() to authenticated;
grant execute on function public.pay_hidden_employee_ids() to service_role;

-- ---------------------------------------------------------------------------
-- Service charge (00103). The store-scope branch is kept as it was: a venue's manager still sees
-- their own venue's pool. A hidden employee's allocation line is withheld from BOTH branches —
-- the amount is the person's pay whichever door it is read through. The pool row itself
-- (hr_sc_pools: the venue's total) is not a person's figure and stays as it was.
-- ---------------------------------------------------------------------------
drop policy if exists hr_sc_allocations_read on public.hr_sc_allocations;
create policy hr_sc_allocations_read on public.hr_sc_allocations
  for select to authenticated
  using (
    exists (
      select 1 from public.hr_sc_pools p
      where p.id = hr_sc_allocations.pool_id
        and (
          public.can_manage_hr()
          or exists (
            select 1 from public.hr_manager_scopes s
            where s.user_id = (select auth.uid()) and s.store_id = p.store_id
          )
        )
    )
    and hr_sc_allocations.user_id not in (select public.pay_hidden_profile_ids())
  );

drop policy if exists hr_sc_deductions_read on public.hr_sc_deductions;
create policy hr_sc_deductions_read on public.hr_sc_deductions
  for select to authenticated
  using (
    exists (
      select 1
      from public.hr_sc_allocations a
      join public.hr_sc_pools p on p.id = a.pool_id
      where a.id = hr_sc_deductions.allocation_id
        and (
          public.can_manage_hr()
          or exists (
            select 1 from public.hr_manager_scopes s
            where s.user_id = (select auth.uid()) and s.store_id = p.store_id
          )
        )
        and a.user_id not in (select public.pay_hidden_profile_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- Tip pool (00109) — same shape.
-- ---------------------------------------------------------------------------
drop policy if exists hr_tip_allocations_read on public.hr_tip_allocations;
create policy hr_tip_allocations_read on public.hr_tip_allocations
  for select to authenticated
  using (
    exists (
      select 1 from public.hr_tip_pools p
      where p.id = hr_tip_allocations.pool_id
        and (
          public.can_manage_hr()
          or exists (
            select 1 from public.hr_manager_scopes s
            where s.user_id = (select auth.uid()) and s.store_id = p.store_id
          )
        )
    )
    and hr_tip_allocations.user_id not in (select public.pay_hidden_profile_ids())
  );

drop policy if exists hr_tip_deductions_read on public.hr_tip_deductions;
create policy hr_tip_deductions_read on public.hr_tip_deductions
  for select to authenticated
  using (
    exists (
      select 1
      from public.hr_tip_allocations a
      join public.hr_tip_pools p on p.id = a.pool_id
      where a.id = hr_tip_deductions.allocation_id
        and (
          public.can_manage_hr()
          or exists (
            select 1 from public.hr_manager_scopes s
            where s.user_id = (select auth.uid()) and s.store_id = p.store_id
          )
        )
        and a.user_id not in (select public.pay_hidden_profile_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- Imported legacy payslips (00130). One FOR ALL policy becomes a gated SELECT plus the same
-- HR-only writes. Rows keyed to a pending identity rather than an employee (employee_id is null:
-- imported names nobody has claimed yet) stay readable, exactly as /api/hr/imported-payslips
-- filters today — there is no employee row to test the rule against, and a `null not in (...)`
-- would otherwise hide all 693 of them from every HR user the moment one employee is confidential.
-- ---------------------------------------------------------------------------
drop policy if exists hr_imported_payslips_hr_all on public.hr_imported_payslips;

create policy hr_imported_payslips_select on public.hr_imported_payslips
  for select to authenticated
  using (
    public.can_manage_hr()
    and (
      hr_imported_payslips.employee_id is null
      or hr_imported_payslips.employee_id not in (select public.pay_hidden_employee_ids())
    )
  );

create policy hr_imported_payslips_insert on public.hr_imported_payslips
  for insert to authenticated
  with check (public.can_manage_hr());

create policy hr_imported_payslips_update on public.hr_imported_payslips
  for update to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());

create policy hr_imported_payslips_delete on public.hr_imported_payslips
  for delete to authenticated
  using (public.can_manage_hr());
