-- 00081_hr_policies.sql
-- P1.3: company policies/handbook (§E) + employee acknowledgement with signature.
-- Employees READ active policies and acknowledge (sign) them; HR CRUD. Re-ack required on version bump.

create table if not exists public.hr_policies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,                       -- handbook section (18 categories §E), free text
  body text,                           -- policy content
  version int not null default 1,      -- bumped on material edit → forces re-ack
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id)
);
create trigger hr_policies_set_updated_at before update on public.hr_policies
  for each row execute function public.hr_set_updated_at();

create table if not exists public.hr_policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.hr_policies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  policy_version int not null,
  signature_path text,                 -- private hr-documents storage key
  acked_at timestamptz not null default now(),
  unique (policy_id, user_id, policy_version)
);
create index if not exists hr_policy_ack_user_idx on public.hr_policy_acknowledgements(user_id);
create index if not exists hr_policy_ack_policy_idx on public.hr_policy_acknowledgements(policy_id);

alter table public.hr_policies enable row level security;
alter table public.hr_policy_acknowledgements enable row level security;

-- policies: employees read active ones; HR sees all + writes.
create policy hr_policies_select on public.hr_policies
  for select to authenticated using (active = true or public.can_manage_hr());
create policy hr_policies_write on public.hr_policies
  for all to authenticated using (public.can_manage_hr()) with check (public.can_manage_hr());

-- acknowledgements: a user sees/creates their own; HR sees all. (Server writes via service role;
-- the self-scoped insert policy is defense-in-depth.)
create policy hr_policy_ack_select on public.hr_policy_acknowledgements
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_hr());
create policy hr_policy_ack_insert on public.hr_policy_acknowledgements
  for insert to authenticated
  with check (user_id = (select auth.uid()));
