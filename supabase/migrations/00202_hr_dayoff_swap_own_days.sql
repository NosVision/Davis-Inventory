-- 00202_hr_dayoff_swap_own_days.sql
-- Day-off swap approval exchanged the WRONG cells (owner report 2026-09-13).
--
-- 00088 traded the requester's cell on requester_date with the COUNTERPART's cell on counterpart_date.
-- That is only right when both dates are the same day. Filed across two days — "I'm off on the 9th,
-- I want the 12th instead" — the requester's day off landed on the coworker: House of Savoy,
-- 11/09/2026, three swaps, and the requester ended up with no day off at all while the coworker
-- gained three.
--
-- A swap across two days now means each person swaps THEIR OWN two days (owner decision 2026-09-13):
--   • requester_date is the requester's current day off, counterpart_date the day they want off
--     instead — so the requester must be off on the first and rostered to work on the second.
--   • the counterpart's two days swap only when they mirror the requester's (working on
--     requester_date, off on counterpart_date): then the two really are trading days off. Any other
--     shape — working both days, say — leaves their roster alone; they are covering, not trading.
--   • the same date on both sides → the two people trade that day's assignment, as before.
-- Every cell must belong to the swap's store.
--
-- src/lib/hr/dayoff-swap.ts mirrors this rule for the filing checks and the approver's preview. If
-- one changes, the other must.

comment on column public.hr_dayoff_swaps.requester_date is
  'The requester''s current day off. Equal to counterpart_date = a same-day shift trade.';
comment on column public.hr_dayoff_swaps.counterpart_date is
  'The day the requester wants off instead.';

create or replace function public.hr_approve_dayoff_swap(p_swap_id uuid, p_approver uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.hr_dayoff_swaps;
  req_from public.hr_schedule; -- requester on requester_date
  req_to   public.hr_schedule; -- requester on counterpart_date
  cp_from  public.hr_schedule; -- counterpart on requester_date
  cp_to    public.hr_schedule; -- counterpart on counterpart_date
begin
  select * into s from public.hr_dayoff_swaps where id = p_swap_id for update;
  if not found then raise exception 'swap not found'; end if;
  if s.status <> 'pending' then raise exception 'swap is not pending'; end if;

  if s.requester_date = s.counterpart_date then
    -- Same day: the two people trade that day's assignment.
    select * into req_from from public.hr_schedule
      where user_id = s.requester_id and work_date = s.requester_date and store_id = s.store_id
      for update;
    if not found then raise exception 'requester has no schedule on that date'; end if;
    select * into cp_to from public.hr_schedule
      where user_id = s.counterpart_id and work_date = s.counterpart_date and store_id = s.store_id
      for update;
    if not found then raise exception 'counterpart has no schedule on that date'; end if;

    update public.hr_schedule
      set shift_template_id = cp_to.shift_template_id, is_day_off = cp_to.is_day_off
      where id = req_from.id;
    update public.hr_schedule
      set shift_template_id = req_from.shift_template_id, is_day_off = req_from.is_day_off
      where id = cp_to.id;
  else
    select * into req_from from public.hr_schedule
      where user_id = s.requester_id and work_date = s.requester_date and store_id = s.store_id
      for update;
    if not found then raise exception 'requester has no schedule on the day off'; end if;
    select * into req_to from public.hr_schedule
      where user_id = s.requester_id and work_date = s.counterpart_date and store_id = s.store_id
      for update;
    if not found then raise exception 'requester has no schedule on the wanted day'; end if;
    select * into cp_from from public.hr_schedule
      where user_id = s.counterpart_id and work_date = s.requester_date and store_id = s.store_id
      for update;
    if not found then raise exception 'counterpart has no schedule on the day off'; end if;
    select * into cp_to from public.hr_schedule
      where user_id = s.counterpart_id and work_date = s.counterpart_date and store_id = s.store_id
      for update;
    if not found then raise exception 'counterpart has no schedule on the wanted day'; end if;

    -- The roster may have moved since filing; approving must still do what was asked.
    if not req_from.is_day_off or req_to.is_day_off then
      raise exception 'requester roster no longer matches the request';
    end if;

    -- The requester swaps their own two days.
    update public.hr_schedule
      set shift_template_id = req_to.shift_template_id, is_day_off = req_to.is_day_off
      where id = req_from.id;
    update public.hr_schedule
      set shift_template_id = req_from.shift_template_id, is_day_off = req_from.is_day_off
      where id = req_to.id;

    -- The counterpart swaps theirs only when they are really trading days off.
    if not cp_from.is_day_off and cp_to.is_day_off then
      update public.hr_schedule
        set shift_template_id = cp_to.shift_template_id, is_day_off = cp_to.is_day_off
        where id = cp_from.id;
      update public.hr_schedule
        set shift_template_id = cp_from.shift_template_id, is_day_off = cp_from.is_day_off
        where id = cp_to.id;
    end if;
  end if;

  update public.hr_dayoff_swaps
    set status = 'approved', decided_by = p_approver, decided_at = now()
    where id = p_swap_id;
end;
$$;

-- CREATE OR REPLACE keeps 00089's grants; restated so this file stands on its own.
revoke all on function public.hr_approve_dayoff_swap(uuid, uuid) from public, anon, authenticated;
grant execute on function public.hr_approve_dayoff_swap(uuid, uuid) to service_role;
