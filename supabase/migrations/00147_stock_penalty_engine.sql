-- 00147_stock_penalty_engine.sql
-- Stock-penalty engine foundation (owner ask 2026-07-09). See docs/hr/stock-penalty-to-hr.md.
-- Weekly SV-fine escalation (Mon–Sun) vs monthly SOP count (calendar month) — "two clocks".
-- Pure calc lives in src/lib/stock/penalty-engine.ts; wiring into owner-review comes next stage.

-- penalties: which business date the count audited + the weekly-escalation window & sequence.
alter table public.penalties add column if not exists business_date date;
alter table public.penalties add column if not exists week_key text;   -- 'YYYY-Www' Monday-start
alter table public.penalties add column if not exists week_seq int;     -- 1/2/3 occurrence that week

comment on column public.penalties.week_seq is 'Nth money-eligible A-02 occurrence of the store within week_key (1=free, 2=300, 3=500)';

-- Global settings (HQ-editable later). Fines in baht to match penalties.amount.
insert into public.hr_policy_settings (key, value) values
  ('stock_fine_tiers',         '[0, 300, 500]'::jsonb),
  ('stock_warning_threshold',  '7'::jsonb),
  ('stock_escalation_auto_hr', 'false'::jsonb),
  ('stock_week_start',         '"monday"'::jsonb)
on conflict (key) do nothing;

-- Per-store monthly SOP point count (calendar month via penalties.month_year) — drives the
-- 7-point → head_bar warning. Counts every included_in_quota violation (all codes except EXP-01).
create or replace view public.v_store_monthly_sop_count as
select
  store_id,
  month_year,
  count(*)::int                          as points,
  sum(coalesce(amount, 0))::numeric      as total_amount
from public.penalties
where included_in_quota = true
  and coalesce(status, '') <> 'cancelled'
group by store_id, month_year;
