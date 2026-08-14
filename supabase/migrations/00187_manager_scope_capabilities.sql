-- 00187_manager_scope_capabilities.sql
--
-- Split venue authority in two, so a captain can run the roster without gaining a say over leave
-- (client request 2026-08-14: leave approval stays with the manager and HR; the schedule, days off
-- and day-off swaps move to the captain).
--
-- hr_manager_scopes was all-or-nothing: one row handed the same person the roster, leave, OT,
-- attendance corrections, expense claims and the geofence. Adding a captain to it as it stood
-- would have handed them leave approval too — the one thing the client was separating.
--
-- Two flags rather than a role name, because the question each gate asks is "may this person do
-- THIS", not "what are they called". A venue can have several of each: the unique key is
-- (user_id, store_id), so two captains on one store both see the same roster, which is what was
-- asked for.
--
--   can_schedule  — the roster: shifts, days off, day-off swaps
--   can_approve   — leave, OT, attendance corrections and review, claims, geofence
--
-- Both default true so every existing row keeps exactly the authority it has today, and any
-- INSERT that predates this migration still produces a full manager.

alter table public.hr_manager_scopes
  add column if not exists can_schedule boolean not null default true,
  add column if not exists can_approve  boolean not null default true;

comment on column public.hr_manager_scopes.can_schedule is
  'Roster authority: build the schedule, set days off, decide day-off swaps.';
comment on column public.hr_manager_scopes.can_approve is
  'Approval authority: leave, OT, attendance corrections, claims, store geofence.';

-- A row granting neither is not a grant at all — it would show the person a venue they cannot act
-- on, which reads as a bug rather than a permission.
alter table public.hr_manager_scopes
  drop constraint if exists hr_manager_scopes_grants_something;
alter table public.hr_manager_scopes
  add constraint hr_manager_scopes_grants_something
  check (can_schedule or can_approve);
