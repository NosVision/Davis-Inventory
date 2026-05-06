-- ============================================================================
-- 00043_hq_deposits_session.sql
--
-- Group items received in the same physical event so the HQ history view
-- and printable report can show "Baccarat — 17 of 18 received together
-- on 5 May" instead of a flat list of items. Existing rows are
-- back-filled by clustering on (received_by, from_store_id, minute) —
-- before the partial-receipt UI existed every batch confirm wrote all
-- items in one transaction, so the same person + store + minute is a
-- safe proxy for "same session".
-- ============================================================================

ALTER TABLE public.hq_deposits
  ADD COLUMN IF NOT EXISTS received_session_id UUID;

COMMENT ON COLUMN public.hq_deposits.received_session_id IS
  'Groups items confirmed in the same receive action — multiple items can share one photo, one receiver, one notes string.';

-- Back-fill: cluster rows received within the same minute by the same
-- person from the same store. Anything older than that is treated as
-- a separate session.
WITH grouped AS (
  SELECT
    gen_random_uuid() AS session_id,
    received_by,
    from_store_id,
    date_trunc('minute', received_at) AS minute_bucket
  FROM public.hq_deposits
  WHERE received_session_id IS NULL
    AND received_at IS NOT NULL
  GROUP BY received_by, from_store_id, date_trunc('minute', received_at)
)
UPDATE public.hq_deposits h
SET received_session_id = g.session_id
FROM grouped g
WHERE h.received_by IS NOT DISTINCT FROM g.received_by
  AND h.from_store_id IS NOT DISTINCT FROM g.from_store_id
  AND date_trunc('minute', h.received_at) = g.minute_bucket
  AND h.received_session_id IS NULL;

-- Index used by the history view (range scan by date + group by session).
CREATE INDEX IF NOT EXISTS idx_hq_deposits_received_at
  ON public.hq_deposits(received_at DESC)
  WHERE received_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hq_deposits_session
  ON public.hq_deposits(received_session_id)
  WHERE received_session_id IS NOT NULL;
