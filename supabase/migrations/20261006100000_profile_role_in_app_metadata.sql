-- Mirror profiles.role into auth.users.raw_app_meta_data.role.
--
-- The middleware gates routes by role on every request. With no role in
-- app_metadata it fell back to a profiles query per request (0 of 355 users
-- had one), which doubled the Supabase round trips at the 04:00 shift-end
-- peak and helped push the database into statement timeouts.
--
-- profiles.role stays the source of truth; app_metadata is a copy that only
-- the service side can write (users cannot edit app_metadata). The middleware
-- keeps its profiles fallback, so a row whose copy is missing still works.

create or replace function public.sync_role_to_app_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('role', new.role::text)
   where id = new.id
     and raw_app_meta_data->>'role' is distinct from new.role::text;
  return new;
end;
$$;

revoke all on function public.sync_role_to_app_metadata() from public, anon, authenticated;

drop trigger if exists trg_profiles_sync_role_app_metadata on public.profiles;
create trigger trg_profiles_sync_role_app_metadata
  after insert or update of role on public.profiles
  for each row execute function public.sync_role_to_app_metadata();

-- Backfill every existing account.
update auth.users u
   set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('role', p.role::text)
  from public.profiles p
 where p.id = u.id
   and u.raw_app_meta_data->>'role' is distinct from p.role::text;
