-- 00088_hr_dayoff_swaps.sql
-- P2.3 day-off / shift swap (§C). Two employees agree offline; the requester files a
-- swap of their scheduled cell with a coworker's cell. A store approver (manager or HR,
-- via can_manage_store) approves; on approval the two hr_schedule cells' assignments are
-- exchanged ATOMICALLY. HR is NOT an approval step — it only acknowledges afterwards.

create table if not exists public.hr_dayoff_swaps (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  requester_date date not null,
  counterpart_id uuid not null references public.profiles(id) on delete cascade,
  counterpart_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  hr_acked_by uuid references public.profiles(id),
  hr_acked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_dayoff_swaps_distinct check (requester_id <> counterpart_id)
);
create index if not exists hr_dayoff_swaps_store_idx on public.hr_dayoff_swaps(store_id, status);
create index if not exists hr_dayoff_swaps_requester_idx on public.hr_dayoff_swaps(requester_id);
create index if not exists hr_dayoff_swaps_counterpart_idx on public.hr_dayoff_swaps(counterpart_id);
create trigger hr_dayoff_swaps_set_updated_at before update on public.hr_dayoff_swaps
  for each row execute function public.hr_set_updated_at();

-- Atomic approval: verify the swap is pending, lock and exchange the two schedule cells'
-- assignment (shift vs day-off), then mark it approved. Any precondition failure raises,
-- rolling the whole thing back. SECURITY DEFINER — the app authorizes the approver first.
create or replace function public.hr_approve_dayoff_swap(p_swap_id uuid, p_approver uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.hr_dayoff_swaps;
  a public.hr_schedule;
  b public.hr_schedule;
begin
  select * into s from public.hr_dayoff_swaps where id = p_swap_id for update;
  if not found then raise exception 'swap not found'; end if;
  if s.status <> 'pending' then raise exception 'swap is not pending'; end if;

  select * into a from public.hr_schedule
    where user_id = s.requester_id and work_date = s.requester_date for update;
  if not found then raise exception 'requester has no schedule on that date'; end if;
  select * into b from public.hr_schedule
    where user_id = s.counterpart_id and work_date = s.counterpart_date for update;
  if not found then raise exception 'counterpart has no schedule on that date'; end if;

  -- exchange the assignment content; both cells keep their own user_id + work_date
  update public.hr_schedule
    set shift_template_id = b.shift_template_id, is_day_off = b.is_day_off
    where id = a.id;
  update public.hr_schedule
    set shift_template_id = a.shift_template_id, is_day_off = a.is_day_off
    where id = b.id;

  update public.hr_dayoff_swaps
    set status = 'approved', decided_by = p_approver, decided_at = now()
    where id = p_swap_id;
end;
$$;

alter table public.hr_dayoff_swaps enable row level security;

-- involved employees (requester / counterpart) and the store's managers / HR can read.
create policy hr_dayoff_swaps_select on public.hr_dayoff_swaps
  for select to authenticated
  using (
    requester_id = (select auth.uid())
    or counterpart_id = (select auth.uid())
    or public.can_manage_store(store_id)
  );
-- a staff member files their own request (requester = themselves).
create policy hr_dayoff_swaps_insert on public.hr_dayoff_swaps
  for insert to authenticated
  with check (requester_id = (select auth.uid()));
-- store managers / HR decide; the requester may cancel their own request.
create policy hr_dayoff_swaps_update on public.hr_dayoff_swaps
  for update to authenticated
  using (public.can_manage_store(store_id) or requester_id = (select auth.uid()))
  with check (public.can_manage_store(store_id) or requester_id = (select auth.uid()));
