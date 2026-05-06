-- ============================================================================
-- 00046_backfill_legacy_transfer_fields.sql
--
-- Legacy transfers (e.g. TRF-2026-0018) imported in bulk landed in the
-- DB without product_name, created_at, requested_by, photo_url. The
-- HQ "ดูรายละเอียด" panel showed "—" for transfer date + submitter +
-- product. The truth for product + a usable approximation for the date
-- live on the linked deposits row, so copy them down.
--
-- requested_by has no recoverable source (the bulk import didn't
-- record who pressed "transfer" originally) so it stays NULL — the UI
-- now shows "ไม่ระบุ" for that case.
-- ============================================================================

-- 1. product_name ← deposits.product_name (744 rows affected)
UPDATE public.transfers t
SET product_name = d.product_name
FROM public.deposits d
WHERE t.deposit_id = d.id
  AND t.product_name IS NULL
  AND d.product_name IS NOT NULL;

-- 2. created_at ← deposits.created_at (441 rows affected). Approximate:
-- the deposit's intake date stands in for the transfer date when the
-- original timestamp wasn't recorded. Better than NULL, and any newer
-- transfer (where the column exists from the start) keeps its real
-- value untouched. 41 transfers still have NULL created_at because
-- their parent deposit is also missing a date.
UPDATE public.transfers t
SET created_at = d.created_at
FROM public.deposits d
WHERE t.deposit_id = d.id
  AND t.created_at IS NULL
  AND d.created_at IS NOT NULL;
