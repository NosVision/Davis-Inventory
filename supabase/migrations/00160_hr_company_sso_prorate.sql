-- 00160 — per-company toggle for how SSO is based on a mid-month hire/leaver (§Phase 1).
-- Default false preserves the existing behaviour: SSO = 5% of the FULL monthly rate (capped).
-- When true, SSO is computed on the PRORATED salary actually earned in the period (matching how the
-- provident-fund contribution is already prorated), so a mid-month joiner isn't over-charged. For a
-- full-month employee, and for anyone at/above the wage ceiling, the two are identical.

alter table public.hr_companies
  add column if not exists sso_prorate boolean not null default false;

comment on column public.hr_companies.sso_prorate is
  'When true, SSO is computed on the prorated salary earned in the period (not the full monthly rate). Only affects mid-month hires/leavers below the SSO wage ceiling.';
