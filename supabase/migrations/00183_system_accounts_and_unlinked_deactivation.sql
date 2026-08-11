-- 00183_system_accounts_and_unlinked_deactivation.sql
-- Applied to production 2026-08-11.
--
-- 1) profiles.is_system — accounts that are machines or test fixtures, not people. They must never
--    appear in an attendance file, a payroll run or a roster. Until now this was inferred from the
--    username prefix 'printer-%' at each call site, which only ever caught printers and only where
--    someone remembered to write the filter — the timesheet had no such filter at all, so print
--    servers showed up as rows in the attendance file with no punches and nothing to explain.
--
-- 2) Deactivate every account with no hr_employees record, so the only people who can log in are
--    the ones payroll knows about. 101 accounts: 72 staff, 23 bar, 3 accountant, 1 hq, 1 manager,
--    1 technician.
--
--    Owners are exempt. None of the four draws a salary through the system, so all four match the
--    rule — and owner is the only role that can manage permissions, so the sweep would have locked
--    the system's administrators out of it permanently.
--
--    System accounts are exempt too: scripts/hr-e2e/* signs in as the hr-test-* fixtures, and the
--    print servers need their logins to authenticate.
--
--    Reversible by design — HR reactivates and links anyone who turns out to still need access.

alter table public.profiles
  add column if not exists is_system boolean not null default false;

comment on column public.profiles.is_system is
  'Machine or test-fixture account, not a person. Excluded from attendance exports, payroll runs and staff rosters. Never deactivated by the unlinked-account sweep.';

create index if not exists idx_profiles_is_system on public.profiles (is_system) where is_system;

-- Print-server logins (printer-{store_code}) — store members so the print server can authenticate.
update public.profiles set is_system = true where username like 'printer-%' and not is_system;

-- HR E2E fixtures. Same category: not people, and the test suite signs in as them.
update public.profiles set is_system = true where username like 'hr-test-%' and not is_system;

-- The sweep.
update public.profiles p
set active = false
where p.active
  and p.role <> 'customer'
  and p.role <> 'owner'
  and not p.is_system
  and not exists (select 1 from public.hr_employees e where e.profile_id = p.id);
