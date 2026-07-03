-- P4.3 review (HIGH, security): the ESS "my payslips" invariant "an employee may see
-- their OWN payslip only when its payrun is FINALIZED (never a draft, still-changing one)"
-- lived ONLY in application code (src/app/api/hr/ess/payslips/route.ts, service-role +
-- JS filter). RLS on hr_payslips enforced own-row but NOT finalized-only, so any future
-- code path that reads hr_payslips with the caller's own (RLS-governed) client — a new ESS
-- route, a createServiceClient()->createClient() refactor, a direct PostgREST query — would
-- expose draft payslip figures. This makes RLS itself enforce both constraints.
--
-- hr_payruns is HR-only readable (hr_payruns_all policy), so an inline `exists(select 1 from
-- hr_payruns ...)` subquery would be RLS-filtered to false for employees. It must go through
-- a SECURITY DEFINER helper (same pattern as can_manage_hr()).

create or replace function public.hr_payrun_is_finalized(p_payrun_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_payruns
    where id = p_payrun_id and status = 'finalized'
  );
$$;

revoke all on function public.hr_payrun_is_finalized(uuid) from public;
grant execute on function public.hr_payrun_is_finalized(uuid) to authenticated;

drop policy if exists hr_payslips_select on public.hr_payslips;
create policy hr_payslips_select on public.hr_payslips
  for select to authenticated
  using (
    public.can_manage_hr()
    or (user_id = (select auth.uid()) and public.hr_payrun_is_finalized(payrun_id))
  );
