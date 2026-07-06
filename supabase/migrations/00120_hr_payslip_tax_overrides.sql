-- Official tax figures from the accounting office (owner plan 2026-07-06): the engine's
-- progressive-PND1 number is an ESTIMATE — the accountant holds YTD income and personal
-- allowance documents, so the binding number is keyed in per person (via the review link,
-- or by HR as a fallback) and OVERRIDES the engine's tax on the slip.
-- Keyed by (payrun, profile) — NOT by payslip id — so a draft regenerate rebuilds slips and
-- the override still re-applies.
create table public.hr_payslip_tax_overrides (
  id uuid primary key default gen_random_uuid(),
  payrun_id uuid not null references public.hr_payruns(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tax_satang bigint not null check (tax_satang >= 0),
  note text,
  set_via text not null default 'hr' check (set_via in ('hr', 'link')),
  set_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payrun_id, profile_id)
);

alter table public.hr_payslip_tax_overrides enable row level security;

-- HR-only via RLS; the accountant review link writes through a service-role route whose
-- access is gated by a hashed token instead.
create policy hr_payslip_tax_overrides_hr_all on public.hr_payslip_tax_overrides
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());
