-- Staff could no longer receive a customer's LINE OA deposit (report 2026-09-13, Upper House).
--
-- 20260910115918 made expiry/VIP changes Bar-only — for a deposit that already exists. But receiving a
-- LINE OA request is an UPDATE of the customer's `pending_staff` row, and that update is where the
-- deposit gets its expiry and VIP state for the first time. Every receive path (deposit form, chat
-- action card, my-tasks) writes them, so from 10/09 on any Service (staff) or manager account got
-- "Only the Bar role may change deposit expiry or VIP status" and the save failed — while Bar
-- accounts kept working, which is why "some people can and some can't".
--
-- A walk-in deposit sets the same two fields on INSERT, which this UPDATE-only trigger never sees, so
-- staff were always allowed to set them at intake. Receiving a request is that same intake: while the
-- row is still `pending_staff` it is not a deposit yet, and the Bar-only rule does not apply. Once it
-- has been received, only Bar may change them, as before.
--
-- `head_bar` is added beside `bar`: it is the Bar role with seniority (head_bar = bar access), and the
-- original check left it out.

create or replace function public.enforce_deposit_expiry_vip_bar_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.expiry_date is distinct from old.expiry_date
     or new.is_vip is distinct from old.is_vip then
    -- Intake of a customer's request sets these for the first time.
    if old.status = 'pending_staff' then
      return new;
    end if;
    if auth.role() is distinct from 'service_role'
       and coalesce(public.get_user_role()::text, '') not in ('bar', 'head_bar') then
      raise exception 'Only the Bar role may change deposit expiry or VIP status'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
