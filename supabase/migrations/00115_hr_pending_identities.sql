-- Employee identity claiming (owner-designed flow, 2026-07-05): the payroll sheets carry ~244
-- REAL Thai full names while app accounts use English nicknames, so instead of HR guessing the
-- mapping, every sheet row is imported here and each UNLINKED user is prompted (modal) to pick
-- their own real name. HR then reviews the claim and approving creates the hr_employees record
-- attached to the claimant's existing profiles.id (the R114 link mechanism).
--
-- Status machine: unclaimed → claimed (employee picked it, awaiting HR) → linked (HR approved,
-- hr_employees created). Reject returns claimed → unclaimed (review_note keeps the reason).
--
-- Rows carry payroll seed data (rate/start/SSO/tax) from the sheet — SENSITIVE. RLS is HR-only;
-- employee interactions go through server routes that expose names only.

create table public.hr_pending_identities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.hr_companies(id) on delete restrict,
  store_id uuid references public.stores(id) on delete set null,
  full_name_th text not null,
  position_text text,
  rate_satang bigint not null default 0 check (rate_satang >= 0),
  pay_type text not null default 'full_monthly',
  start_date date,
  sso_enrolled boolean not null default true,
  tax_mode text not null default 'progressive',
  sheet_ref text, -- e.g. 'Baccarat#12' — traceability back to the source sheet row
  status text not null default 'unclaimed' check (status in ('unclaimed', 'claimed', 'linked')),
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  linked_employee_id uuid references public.hr_employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

-- one sheet row per person per company; idempotent re-imports upsert on this
create unique index hr_pending_identities_company_name
  on public.hr_pending_identities (company_id, full_name_th);
-- a user may have at most ONE claim awaiting review
create unique index hr_pending_identities_one_open_claim
  on public.hr_pending_identities (claimed_by) where status = 'claimed';
create index hr_pending_identities_status on public.hr_pending_identities (status);

alter table public.hr_pending_identities enable row level security;

-- HR-only via RLS (rows carry salary seed data). Employees NEVER read this table directly —
-- the ESS claim routes are service-role and return names only.
create policy hr_pending_identities_hr_all on public.hr_pending_identities
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());

create trigger hr_pending_identities_touch
  before update on public.hr_pending_identities
  for each row execute function public.update_updated_at_column();
