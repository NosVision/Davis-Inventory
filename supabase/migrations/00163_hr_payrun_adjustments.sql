-- 00163: per-payrun one-off adjustment lines + per-person payrun remarks (payroll redesign,
-- owner approval 2026-07-14: the "no manual numbers" rule is NARROWED, not repealed — HR may
-- APPEND attributed, reasoned one-off lines; engine-computed lines stay untouchable).
--
-- hr_payrun_adjustments is keyed (payrun_id, profile_id) — NOT payslip_id — because a draft
-- regenerate deletes every payslip (ids change); this is the same durable-survivor pattern as
-- hr_payslip_tax_overrides / hr_payslip_bonuses. Multiple rows per person allowed. The generate
-- loop re-posts each row as a payslip line of type 'adjustment' with ref = the adjustment id.

create table if not exists public.hr_payrun_adjustments (
  id uuid primary key default gen_random_uuid(),
  payrun_id uuid not null references public.hr_payruns(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('earning','deduction')),
  label text not null check (length(trim(label)) > 0),
  amount_satang bigint not null check (amount_satang > 0),
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists hr_payrun_adjustments_payrun_idx on public.hr_payrun_adjustments (payrun_id);

alter table public.hr_payrun_adjustments enable row level security;
create policy hr_payrun_adjustments_hr_all on public.hr_payrun_adjustments
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());

-- Free-form per-person remark on a payrun (the legacy Payment file's Remark column, e.g.
-- "หัก SV 100%"). Durable across regenerates (hr_payslips.note is wiped with the slip).
create table if not exists public.hr_payrun_remarks (
  payrun_id uuid not null references public.hr_payruns(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  remark text not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (payrun_id, profile_id)
);

alter table public.hr_payrun_remarks enable row level security;
create policy hr_payrun_remarks_hr_all on public.hr_payrun_remarks
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());

-- Adjustment lines land on the slip as their own type so they are forever distinguishable from
-- recurring 'other' lines (mirrors 00111/00129 — additive, existing slips unaffected).
alter table public.hr_payslip_earnings drop constraint if exists hr_payslip_earnings_type_check;
alter table public.hr_payslip_earnings
  add constraint hr_payslip_earnings_type_check
  check (type in (
    'salary','ot','allowance','service_charge','commission','eval_bonus','bonus','claim','tip','adjustment'
  ));

alter table public.hr_payslip_deductions drop constraint if exists hr_payslip_deductions_type_check;
alter table public.hr_payslip_deductions
  add constraint hr_payslip_deductions_type_check
  check (type in (
    'sso','tax','late','absent','leave_unpaid','travel_leave',
    'student_loan','advance','guarantee','loan','provident_fund','other','adjustment'
  ));
