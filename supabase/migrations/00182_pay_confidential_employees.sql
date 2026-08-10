-- 00182_pay_confidential_employees.sql
-- Applied to production 2026-08-08.
--
-- Confidential pay: a second HR user must be able to run HR — including payroll for most people —
-- without seeing what a named handful earn (the accounting team, per the owner).
--
-- Why a per-employee flag and not a separate hr_companies row: `hr_companies` carries tax_id,
-- sso_rate and wht_rate, and drives ภ.ง.ด.1, สปส. and ใบ 50 ทวิ. Inventing a company to hold these
-- people would file their tax under a legal entity that does not exist. The flag keeps them in
-- their real company and gates only who may see the numbers.
--
-- The design rule is "hide the NUMBERS, not the PERSON": a confidential employee stays fully
-- visible for leave, scheduling and attendance, or the restricted HR user could not do their job
-- for that person at all.

alter table public.hr_employees
  add column if not exists pay_confidential boolean not null default false;

comment on column public.hr_employees.pay_confidential is
  'Pay figures for this employee are visible only to holders of can_view_confidential_pay. The person stays fully visible for people-ops (leave, schedule, attendance); only money is gated.';

create index if not exists idx_hr_employees_pay_confidential
  on public.hr_employees (pay_confidential) where pay_confidential;

-- Mirrors can_manage_hr(): owner always, otherwise an explicit grant. SECURITY DEFINER +
-- pinned search_path like its sibling, so RLS can call it without recursing into user_permissions.
create or replace function public.can_view_confidential_pay()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select p.role = 'owner' from public.profiles p where p.id = auth.uid()), false)
    or exists (
      select 1 from public.user_permissions up
      where up.user_id = auth.uid() and up.permission = 'can_view_confidential_pay'
    );
$$;

comment on function public.can_view_confidential_pay is
  'True when the caller may see pay for employees flagged hr_employees.pay_confidential. Owner always; otherwise an explicit user_permissions grant.';

-- Payslips: an HR user without the grant cannot read a confidential employee's slip at all.
-- The employee's own row (finalized payruns) is untouched — people always see their own pay.
drop policy if exists "hr_payslips_select" on public.hr_payslips;
create policy "hr_payslips_select" on public.hr_payslips
  for select to authenticated
  using (
    (
      can_manage_hr()
      and (
        can_view_confidential_pay()
        or not exists (
          select 1 from public.hr_employees e
          where e.profile_id = hr_payslips.user_id and e.pay_confidential
        )
      )
    )
    or (user_id = (select auth.uid()) and hr_payrun_is_finalized(payrun_id))
  );

-- The audit log stores before/after payloads verbatim, salary included, and was readable by any
-- can_manage_hr() holder — the quietest way around the whole feature.
drop policy if exists "hr_audit_log_select" on public.hr_audit_log;
create policy "hr_audit_log_select" on public.hr_audit_log
  for select to authenticated
  using (
    can_manage_hr()
    and (
      can_view_confidential_pay()
      or not exists (
        select 1 from public.hr_employees e
        where e.pay_confidential
          and (
            (hr_audit_log.table_name = 'hr_employees' and hr_audit_log.record_id = e.id)
            or hr_audit_log.record_id = e.profile_id
          )
      )
    )
  );
