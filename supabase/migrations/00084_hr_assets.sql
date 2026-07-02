-- 00084_hr_assets.sql
-- P1.4: company asset register (§11) — uniforms/radios/keys/equipment assigned to employees,
-- with value (satang) and return status. Lost/damaged feeds a payroll deduction later (P3.5).

create table if not exists public.hr_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,                        -- uniform | radio | key | equipment | other (free text)
  asset_code text,
  holder_id uuid references public.profiles(id) on delete set null,  -- current holder (nullable = in stock)
  value_satang bigint not null default 0,
  status text not null default 'in_stock'
    check (status in ('in_stock','issued','returned','lost','damaged')),
  issued_date date,
  returned_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id)
);
create index if not exists hr_assets_holder_idx on public.hr_assets(holder_id);
create index if not exists hr_assets_status_idx on public.hr_assets(status);
create trigger hr_assets_set_updated_at before update on public.hr_assets
  for each row execute function public.hr_set_updated_at();

alter table public.hr_assets enable row level security;

-- HR-only for now (employee "my assets" ESS view can be added later).
create policy hr_assets_select on public.hr_assets
  for select to authenticated using (public.can_manage_hr());
create policy hr_assets_write on public.hr_assets
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());
