-- ============================================================================
-- 00044_hq_deposits_dedupe_and_backfill.sql
--
-- Cleans up the 2,836 duplicate hq_deposits the auto-repair side-effect on
-- /hq-warehouse created over four page loads (709 confirmed transfers ×
-- 4 runs). The dedup `WHERE transfer_id IN (...709 UUIDs)` clause in that
-- code path silently overflows PostgREST's URL length limit so every
-- subsequent load saw the same 709 transfers as orphans and re-inserted
-- them, each time with NULL product_name (because transfers.product_name
-- itself is null on this dataset — only deposits has the real product).
--
-- Steps:
--   1. Pick one survivor per transfer_id — preferring the row with the
--      most complete data, then the oldest.
--   2. Delete the rest.
--   3. Backfill product_name / customer_name / deposit_code on every row
--      whose linked deposit has the data.
--   4. Add a partial UNIQUE index on transfer_id so any future double
--      insert fails loudly instead of silently piling up ghosts.
-- ============================================================================

BEGIN;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY transfer_id
      ORDER BY
        (CASE WHEN product_name IS NOT NULL THEN 0 ELSE 1 END),
        (CASE WHEN customer_name IS NOT NULL THEN 0 ELSE 1 END),
        (CASE WHEN deposit_code IS NOT NULL THEN 0 ELSE 1 END),
        received_at ASC,
        created_at ASC
    ) AS rk
  FROM public.hq_deposits
  WHERE transfer_id IS NOT NULL
)
DELETE FROM public.hq_deposits h
USING ranked r
WHERE h.id = r.id AND r.rk > 1;

UPDATE public.hq_deposits h
SET
  product_name = COALESCE(h.product_name, d.product_name),
  customer_name = COALESCE(h.customer_name, d.customer_name),
  deposit_code = COALESCE(h.deposit_code, d.deposit_code)
FROM public.deposits d
WHERE h.deposit_id = d.id
  AND (h.product_name IS NULL OR h.customer_name IS NULL OR h.deposit_code IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_hq_deposits_transfer
  ON public.hq_deposits(transfer_id)
  WHERE transfer_id IS NOT NULL;

COMMIT;
