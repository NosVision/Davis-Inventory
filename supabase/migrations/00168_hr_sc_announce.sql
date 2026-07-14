-- 00168: SC announcement — manual "ประกาศ SV" (never auto on finalize, owner ask 2026-07-15).
-- announce_message holds HR's custom template (null = use the app default); announced_at/by
-- provide the same double-blast protection as payrun announcements.
alter table public.hr_sc_pools
  add column if not exists announced_at timestamptz,
  add column if not exists announced_by uuid references public.profiles(id),
  add column if not exists announce_message text;

comment on column public.hr_sc_pools.announce_message is
  'Custom announcement template ({period}/{amount}/{payDate} placeholders); null = app default';
