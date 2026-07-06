-- Accountant review links (owner plan 2026-07-06): the external accounting office opens a
-- token URL — no account, no login — sees the whole payrun and keys the official tax figures
-- straight into hr_payslip_tax_overrides. The raw token is shown ONCE to HR; only its SHA-256
-- lands here. Expiry + revocation bound the exposure; a finalized payrun is read-only anyway.
create table public.hr_payrun_review_links (
  id uuid primary key default gen_random_uuid(),
  payrun_id uuid not null references public.hr_payruns(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accessed_at timestamptz,
  saved_at timestamptz
);

create index hr_payrun_review_links_payrun on public.hr_payrun_review_links (payrun_id);

alter table public.hr_payrun_review_links enable row level security;

-- HR manages links; the anonymous accountant path goes through service-role routes that
-- authenticate by comparing the hashed token — the table itself is never anon-readable.
create policy hr_payrun_review_links_hr_all on public.hr_payrun_review_links
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());
