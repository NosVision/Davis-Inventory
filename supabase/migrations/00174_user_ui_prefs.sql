-- 00174_user_ui_prefs.sql
-- Per-account UI preferences (owner ask 2026-07-27): the HR hub lets each user pin tiles to the
-- front in their own order, saved as that account's default and auto-loaded on /hr. One row per
-- user; hr_tile_order holds the pinned tile keys in display order. RLS: owner of the row only —
-- reads/writes go straight from the client, no API route needed.
create table if not exists public.user_ui_prefs (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  hr_tile_order jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now()
);

alter table public.user_ui_prefs enable row level security;

create policy "own ui prefs select" on public.user_ui_prefs
  for select using (user_id = (select auth.uid()));
create policy "own ui prefs insert" on public.user_ui_prefs
  for insert with check (user_id = (select auth.uid()));
create policy "own ui prefs update" on public.user_ui_prefs
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
