-- ============================================================================
-- 00047_dedupe_transfer_code_across_stores.sql
--
-- Multiple stores ended up sharing the same transfer_code (TRF-2026-0001
-- through 0011 + TRF-260505-0001) because the legacy bulk-import gave
-- each store its own per-year sequence. transfer_code identifies a
-- BATCH (a single store sending a list of deposits to HQ), but the
-- column is stored on every deposit row in that batch — so we can't
-- naively add UNIQUE(transfer_code) without breaking legitimate N-row
-- batches that share the code.
--
-- What we CAN do is make the code globally identify a batch by
-- appending the source store_code whenever the same code appears under
-- multiple from_store_ids. After this migration, TRF-2026-0001 (which
-- was 78 rows across 2 stores) becomes TRF-2026-0001-UPH and
-- TRF-2026-0001-24 (or similar). Within each store the batch still has
-- multiple rows sharing one code — that's expected.
--
-- The application's generateTransferCode is being switched to a
-- store-scoped format (TRF-{store_code}-{YYMMDD}-{NNNN}) at the same
-- time, so new codes are unique-by-construction across stores.
-- ============================================================================

WITH dup_codes AS (
  SELECT transfer_code
  FROM public.transfers
  WHERE transfer_code IS NOT NULL
  GROUP BY transfer_code
  HAVING COUNT(DISTINCT from_store_id) > 1
)
UPDATE public.transfers t
SET transfer_code = t.transfer_code || '-' || s.store_code
FROM public.stores s
WHERE t.from_store_id = s.id
  AND t.transfer_code IN (SELECT transfer_code FROM dup_codes);
