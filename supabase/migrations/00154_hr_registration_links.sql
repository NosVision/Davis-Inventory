-- HR self-registration links (owner ask 2026-07-10). HR mints a reusable link; a new hire opens
-- it (no login), sets a username + password, matches themselves to an imported identity (or enters
-- name + bank), picks a position/company, and the app creates their real account with role
-- 'not_assign' + an hr_employees record — pending an HR role assignment. The public flow runs
-- through a service-role API (token-gated + rate-limited), so this table is app-managed only:
-- RLS on, no public policy (service role bypasses); the token is a bearer secret in the URL.
create table if not exists public.hr_registration_links (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  company_id  uuid references public.hr_companies(id) on delete set null,
  created_by  uuid references public.profiles(id) on delete set null,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  used_count  integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.hr_registration_links enable row level security;

-- Optional convenience: let company-wide HR read/manage rows directly (the app still writes via the
-- service role). Owners always pass is_admin(); can_manage_hr grantees get read/write here.
drop policy if exists hr_registration_links_admin on public.hr_registration_links;
create policy hr_registration_links_admin on public.hr_registration_links
  for all to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.user_permissions up
      where up.user_id = auth.uid() and up.permission = 'can_manage_hr'
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.user_permissions up
      where up.user_id = auth.uid() and up.permission = 'can_manage_hr'
    )
  );

comment on table public.hr_registration_links is 'HR-minted reusable self-registration links; new hires self-onboard to role not_assign + an hr_employees record.';
