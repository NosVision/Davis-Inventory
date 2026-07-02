-- 00083_hr_announcements_scope_rls.sql
-- P1.3 announcements review fixes:
-- [CRITICAL] enforce store scope in RLS (not just the ESS route) so a browser client
--   cannot read announcements scoped to stores the user is not in.
-- [HIGH] atomic scope replace via SECURITY DEFINER RPC (delete+insert in one txn) so a
--   partial failure can no longer silently convert a store-scoped announcement to company-wide.

-- ---- scope-aware SELECT policies ----
drop policy if exists hr_announcements_select on public.hr_announcements;
create policy hr_announcements_select on public.hr_announcements
  for select to authenticated using (
    public.can_manage_hr()
    or (
      active = true
      and (
        not exists (select 1 from public.hr_announcement_stores s where s.announcement_id = id)
        or exists (
          select 1
          from public.hr_announcement_stores s
          join public.user_stores us on us.store_id = s.store_id
          where s.announcement_id = id and us.user_id = (select auth.uid())
        )
      )
    )
  );

drop policy if exists hr_announcement_stores_select on public.hr_announcement_stores;
create policy hr_announcement_stores_select on public.hr_announcement_stores
  for select to authenticated using (
    public.can_manage_hr()
    or store_id in (select store_id from public.user_stores where user_id = (select auth.uid()))
  );

-- receipts: also require the announcement to be active on direct client write (defense-in-depth).
drop policy if exists hr_announcement_receipts_write on public.hr_announcement_receipts;
create policy hr_announcement_receipts_write on public.hr_announcement_receipts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.hr_announcements a where a.id = announcement_id and a.active = true)
  );

-- ---- atomic scope replace ----
-- Runs delete+insert in one plpgsql transaction; if any inserted store_id is invalid (FK) the
-- whole call rolls back, leaving the previous scope intact instead of an empty (company-wide) set.
-- service-role only (routes call it after requireHrManager); not exposed to anon/authenticated.
create or replace function public.hr_set_announcement_stores(p_announcement_id uuid, p_store_ids uuid[])
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  delete from public.hr_announcement_stores where announcement_id = p_announcement_id;
  insert into public.hr_announcement_stores (announcement_id, store_id)
  select p_announcement_id, s
  from unnest(coalesce(p_store_ids, array[]::uuid[])) as s
  on conflict (announcement_id, store_id) do nothing;
end;
$$;
revoke all on function public.hr_set_announcement_stores(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.hr_set_announcement_stores(uuid, uuid[]) to service_role;
