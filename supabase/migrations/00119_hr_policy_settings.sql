-- Policy settings (owner requirement 2026-07-05: "ปรับได้เกือบทุกจุด ไม่ต้องแก้โค้ด") — a
-- global key-value store for the business rules that were hardcoded in the engine:
-- late-fine tiers, probation length, SC leave divisor, warning-carry toggle, work-index
-- weights/bands. One row per key; code defaults apply when a key is absent, and the seeded
-- defaults EQUAL the previous constants, so behaviour is identical until someone edits.
-- (Per-company money parameters stay on hr_companies — this table is for group-wide rules.)
create table public.hr_policy_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.hr_policy_settings enable row level security;

create policy hr_policy_settings_hr_all on public.hr_policy_settings
  for all to authenticated
  using (public.can_manage_hr())
  with check (public.can_manage_hr());
