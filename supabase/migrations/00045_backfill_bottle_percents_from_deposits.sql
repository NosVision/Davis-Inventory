-- ============================================================================
-- 00045_backfill_bottle_percents_from_deposits.sql
--
-- The May 1 bulk-import script created deposit_bottles rows defaulted to
-- (remaining_percent=100, status='sealed') even when the parent deposit
-- recorded a real remaining percentage at intake time. The data IS in
-- deposits.remaining_percent (e.g. DEP-BCR-AT4GZ has 70% on the deposit
-- but its bottle says 100%). Copy it down for single-bottle deposits;
-- skip multi-bottle ones because the deposit's column is a single value
-- that can't be safely fanned out across bottles with unknown variance.
--
-- Distribution before backfill: 716 bottles at 100%, 8 at 0%, none in
-- between for the bulk-import cohort. After backfill the spread matches
-- the deposit table: 50%, 40%, 70%, 60%, 30%, 80%, 90%, 45%, 35%, 20%,
-- 65%, 10%, 85%, 55%, 75%, 25%, 99%.
-- ============================================================================

WITH targets AS (
  SELECT
    d.id  AS deposit_id,
    d.remaining_percent,
    db.id AS bottle_id
  FROM public.deposits d
  JOIN public.deposit_bottles db ON db.deposit_id = d.id
  WHERE d.remaining_percent IS NOT NULL
    AND d.remaining_percent <> 100
    AND d.quantity = 1                  -- single-bottle only
    AND db.remaining_percent = 100      -- still the bulk default
    AND db.status = 'sealed'            -- haven't been touched since import
)
UPDATE public.deposit_bottles db
SET
  remaining_percent = t.remaining_percent,
  status = CASE
    WHEN t.remaining_percent <= 0 THEN 'consumed'
    WHEN t.remaining_percent >= 100 THEN 'sealed'
    ELSE 'opened'
  END
FROM targets t
WHERE db.id = t.bottle_id;
