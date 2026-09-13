-- Close the hole 20260913200000 opened (code review, 2026-09-13).
--
-- 20260913200000 let staff set expiry/VIP while a deposit is still `pending_staff` — the intake of a
-- customer's LINE OA request. But deposits RLS lets any store member UPDATE a row to any status, so a
-- non-Bar account could move a stored deposit BACK to `pending_staff` (an update the trigger never
-- saw, since it fired only on expiry_date/is_vip) and then change its expiry or VIP freely.
--
-- A deposit only ever enters `pending_staff` when a customer files a request (an INSERT by the
-- customer request endpoint), and no app path or database function moves an existing row back into
-- it. So that move is now refused for everyone but the service role, and the trigger fires on
-- `status` as well — which keeps the intake exemption meaning what it says.

create or replace function public.enforce_deposit_expiry_vip_bar_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  trusted constant boolean := auth.role() is not distinct from 'service_role';
begin
  -- Only a customer's request creates a pending_staff deposit; nobody moves one back into it.
  if new.status = 'pending_staff' and old.status is distinct from 'pending_staff' and not trusted then
    raise exception 'A deposit cannot be moved back to pending_staff'
      using errcode = '42501';
  end if;

  if new.expiry_date is distinct from old.expiry_date
     or new.is_vip is distinct from old.is_vip then
    -- Intake of a customer's request sets these for the first time.
    if old.status = 'pending_staff' then
      return new;
    end if;
    if not trusted
       and coalesce(public.get_user_role()::text, '') not in ('bar', 'head_bar') then
      raise exception 'Only the Bar role may change deposit expiry or VIP status'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_deposit_expiry_vip_bar_only on public.deposits;
create trigger trg_enforce_deposit_expiry_vip_bar_only
  before update of status, expiry_date, is_vip on public.deposits
  for each row execute function public.enforce_deposit_expiry_vip_bar_only();
