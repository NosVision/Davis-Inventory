-- ① Accountant "ตรวจครบแล้ว" confirmation on the review link: the accounting office presses a
-- button when they have checked every row — HR sees the state before finalizing. Saving taxes
-- again AFTER confirming clears it (the data changed; a re-confirm is required).
alter table public.hr_payrun_review_links
  add column confirmed_at timestamptz;

-- ② YTD opening balances: the accounting office holds each employee's accumulated income since
-- January on THEIR side; when the system starts mid-year those pre-system months are keyed once
-- here (per legal entity + person + year). The review link then shows opening + Σ finalized
-- payslips of the same company/year so the accountant can check the tax threshold at a glance.
create table public.hr_ytd_opening (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.hr_companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  gross_satang bigint not null default 0 check (gross_satang >= 0),
  sso_satang bigint not null default 0 check (sso_satang >= 0),
  tax_satang bigint not null default 0 check (tax_satang >= 0),
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, profile_id, year)
);

create trigger hr_ytd_opening_set_updated_at before update on public.hr_ytd_opening
  for each row execute function public.hr_set_updated_at();

alter table public.hr_ytd_opening enable row level security;

-- HR-only, like the rest of payroll. The public review route reads it via service role.
create policy hr_ytd_opening_hr_all on public.hr_ytd_opening
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());
