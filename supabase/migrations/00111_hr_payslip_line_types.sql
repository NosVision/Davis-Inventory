-- Reconcile committed migration history with the LIVE payslip line-type CHECK constraints
-- (schema drift found via live e2e, Round 71).
--
-- The pure payroll engine (src/lib/hr/payroll.ts) emits itemized lines whose `type` is NOT in
-- the CHECK enums as written in the committed 00105 file:
--   • deductions: `provident_fund` (PVD, payroll.ts computePayslip → line 369)
--   • earnings:   `tip`            (tip pool net, payroll.ts → line 270)
-- The live database already accepts both (verified by direct constraint probe), so this is NOT
-- an active production bug — but the committed migrations do not reproduce the live schema: a
-- fresh rebuild / DR / preview branch from 00105 would REJECT these types, and because the batch
-- INSERT in POST /api/hr/payruns was silently unchecked, a PVD-enrolled or tipped employee's slip
-- would then lose ALL its itemized lines while the cached gross/sso/tax/net totals stayed correct.
-- This migration makes the file history converge to live; the route is additionally hardened to
-- fail loudly on any line-insert error so the same drift can never regress silently again.
-- Idempotent (drop-if-exists + re-add): a no-op where the live constraint already permits these.

alter table public.hr_payslip_deductions drop constraint if exists hr_payslip_deductions_type_check;
alter table public.hr_payslip_deductions
  add constraint hr_payslip_deductions_type_check
  check (type in (
    'sso','tax','late','absent','leave_unpaid','travel_leave',
    'student_loan','advance','guarantee','loan','provident_fund','other'
  ));

alter table public.hr_payslip_earnings drop constraint if exists hr_payslip_earnings_type_check;
alter table public.hr_payslip_earnings
  add constraint hr_payslip_earnings_type_check
  check (type in (
    'salary','ot','allowance','service_charge','commission','eval_bonus','claim','tip'
  ));
