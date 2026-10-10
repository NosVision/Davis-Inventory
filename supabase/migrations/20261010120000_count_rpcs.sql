-- Two count RPCs that replace fan-outs of HEAD count requests from the browser.
--
-- Both are SECURITY INVOKER: they run as the caller, so the tables' row-level security applies
-- exactly as it did to the separate count queries they replace (a bar user still only counts
-- their own venues; owner/accountant count everything through is_admin()).
--
-- Peak-load follow-up, 2026-10-10 (docs/ops/2026-10-09-peak-load-plan.md).

-- Tab counters on the deposit list page: was 7 deposit counts + 1 withdrawals count per page load
-- and per realtime change (612 HEAD requests in 20 min at the 04:00 peak).
create or replace function public.deposit_tab_counts(
  p_store_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'in_store',         count(*) filter (where d.status = 'in_store'),
    'pending_confirm',  count(*) filter (where d.status = 'pending_confirm'),
    'pending_staff',    count(*) filter (where d.status = 'pending_staff'),
    'expired',          count(*) filter (where d.status = 'expired'),
    'cancelled',        count(*) filter (where d.status = 'cancelled'),
    'transfer_pending', count(*) filter (where d.status = 'transfer_pending'),
    'vip',              count(*) filter (where d.is_vip = true),
    'pending_withdrawal', (
      select count(*)
      from public.withdrawals w
      where w.store_id = p_store_id
        and w.status in ('pending', 'approved')
        and (p_from is null or w.created_at >= p_from)
        and (p_to is null or w.created_at <= p_to)
    )
  )
  from public.deposits d
  where d.store_id = p_store_id
    and (p_from is null or d.created_at >= p_from)
    and (p_to is null or d.created_at <= p_to);
$$;

revoke all on function public.deposit_tab_counts(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.deposit_tab_counts(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- Owner/accountant sidebar badge: was 5 separate count queries per refetch, refetched on every
-- change to any of the four source tables.
create or replace function public.inbox_pending_counts()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'explained',        (select count(*) from public.comparisons where status = 'explained'),
    'pending_confirm',  (select count(*) from public.deposits    where status = 'pending_confirm'),
    'pending_staff',    (select count(*) from public.deposits    where status = 'pending_staff'),
    'pending_approval', (select count(*) from public.borrows     where status = 'pending_approval'),
    'transfer_pending', (select count(*) from public.transfers   where status = 'pending')
  );
$$;

revoke all on function public.inbox_pending_counts() from public, anon;
grant execute on function public.inbox_pending_counts() to authenticated, service_role;
