-- 00148_stock_penalty_batch.sql
-- A group fine (e.g. "Bar ทุกคน") creates N penalty rows but is ONE violation occurrence toward
-- the store's monthly SOP threshold (owner ask 2026-07-09). batch_id groups rows made together;
-- the SOP count counts distinct batches (old rows with NULL batch_id count as their own occurrence).
alter table public.penalties add column if not exists batch_id uuid;

create or replace view public.v_store_monthly_sop_count as
select
  store_id,
  month_year,
  count(distinct coalesce(batch_id::text, id::text))::int as points,
  sum(coalesce(amount, 0))::numeric                       as total_amount
from public.penalties
where included_in_quota = true
  and coalesce(status, '') <> 'cancelled'
group by store_id, month_year;
