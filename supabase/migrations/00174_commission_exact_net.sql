-- 00174_commission_exact_net.sql
-- Store the TRUE commission net (no whole-baht rounding) — client ask 2026-07-21. The app
-- now saves net_amount exactly as computed (2 decimals); the whole-baht view became a
-- display-time toggle. Backfill recomputes the exact net for rows that are NOT yet paid and
-- NOT cancelled only: already-paid entries keep the rounded amount that was actually
-- transferred, so historical payments still reconcile with their entries.

update public.commission_entries
set net_amount = round((commission_amount - tax_amount)::numeric, 2),
    rounding = null
where type = 'ae_commission'
  and payment_id is null
  and cancelled_at is null
  and commission_amount is not null
  and tax_amount is not null;

update public.commission_entries
set net_amount = round((coalesce(bottle_count, 1) * coalesce(bottle_rate, 500))::numeric, 2),
    rounding = null
where type = 'bottle_commission'
  and payment_id is null
  and cancelled_at is null;
