-- 00150_stock_sop_per_count_day.sql
-- SOP count = per COUNT-DAY (owner ask 2026-07-10): one business_date with any quota violation =
-- 1 point, regardless of how many products/people/clicks — matching the weekly money escalation
-- (จันทร์/พุธ/ศุกร์). Replaces the per-batch count (00148). Old rows with no business_date fall
-- back to batch_id then id so a legacy group fine still collapses to 1 where possible.
create or replace view public.v_store_monthly_sop_count as
select
  store_id,
  month_year,
  count(distinct coalesce(business_date::text, batch_id::text, id::text))::int as points,
  sum(coalesce(amount, 0))::numeric                                            as total_amount
from public.penalties
where included_in_quota = true
  and coalesce(status, '') <> 'cancelled'
group by store_id, month_year;
