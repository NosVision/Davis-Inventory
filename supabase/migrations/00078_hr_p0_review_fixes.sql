-- 00078_hr_p0_review_fixes.sql
-- P0 gate review fixes (code-reviewer findings). No new tables; tightens RLS + FK on 00077.

-- MED: hr_audit_log had a client INSERT policy allowing any authenticated user to forge
-- self-attributed audit rows (free-form table_name/before/after). Real writes go through
-- logHrAudit() with the service-role client (bypasses RLS), so the client policy only
-- opened a hole. Drop it — no client ever inserts audit directly.
drop policy if exists hr_audit_log_insert on public.hr_audit_log;

-- MED: hr_employees self-view (profile_id = auth.uid()) exposed the full wide row incl.
-- bank_account_no, tax_id, sso_no, notes, end_reason. RLS is row-level, not column-level.
-- Make hr_employees HR-only for P0; employee self-service (ESS) will read a curated,
-- column-limited view/API in later phases instead of the raw table.
drop policy if exists hr_employees_select on public.hr_employees;
create policy hr_employees_select on public.hr_employees
  for select to authenticated using (public.can_manage_hr());

-- LOW: hr_companies carries tax_id + payroll config (sso_rate, ceiling, day_divisor).
-- Restrict read to HR (positions/departments stay open as dropdown data).
drop policy if exists hr_companies_select on public.hr_companies;
create policy hr_companies_select on public.hr_companies
  for select to authenticated using (public.can_manage_hr());

-- MED: profile_id FK was ON DELETE CASCADE — a hard-delete of a profile would silently
-- wipe the employment record (pay refs, bank, documents, dates). Payroll/HR records need
-- retention. Switch to RESTRICT so a profile with HR data cannot be hard-deleted.
alter table public.hr_employees drop constraint hr_employees_profile_id_fkey;
alter table public.hr_employees
  add constraint hr_employees_profile_id_fkey
  foreign key (profile_id) references public.profiles(id) on delete restrict;
