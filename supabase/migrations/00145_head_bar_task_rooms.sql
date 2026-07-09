-- 00145_head_bar_task_rooms.sql
-- head_bar auto-joins the system task rooms exactly like bar (owner ask 2026-07-09): recreate the
-- AFTER INSERT trigger fn from 00051_task_rooms.sql with 'head_bar' added to the eligible-role list.
-- Everything else about head_bar's access is store-membership based (same as bar), so no other RLS
-- change is needed — a head_bar user sees what a bar user in the same store(s) sees.
create or replace function add_user_to_system_task_rooms()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role in ('owner','accountant','manager','bar','head_bar','technician','staff') then
    insert into task_room_members (room_id, user_id, role)
    select tr.id, new.id,
           case when new.role in ('owner','manager') then 'manager' else 'member' end
    from task_rooms tr
    where tr.is_system = true
    on conflict (room_id, user_id) do nothing;
  end if;
  return new;
end $$;
