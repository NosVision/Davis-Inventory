-- HR-entered one-time bonuses, per employee per payrun (owner ask 2026-07-07: a bonus should be
-- an HR-editable line, not a hardcoded/absent concept). Keyed by (payrun, profile) so a DRAFT
-- regenerate re-applies it via the engine — same durable pattern as hr_payslip_tax_overrides.
create table if not exists public.hr_payslip_bonuses (
  id uuid primary key default gen_random_uuid(),
  payrun_id uuid not null references public.hr_payruns(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount_satang bigint not null check (amount_satang >= 0),
  label text,
  set_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payrun_id, profile_id)
);

alter table public.hr_payslip_bonuses enable row level security;

create policy hr_payslip_bonuses_hr_all on public.hr_payslip_bonuses
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());

-- The bonus reaches the slip as an earning line of type 'bonus' — extend the allow-list
-- (mirrors 00111; 'bonus' is additive so existing slips are unaffected).
alter table public.hr_payslip_earnings drop constraint if exists hr_payslip_earnings_type_check;
alter table public.hr_payslip_earnings
  add constraint hr_payslip_earnings_type_check
  check (type in (
    'salary','ot','allowance','service_charge','commission','eval_bonus','bonus','claim','tip'
  ));
