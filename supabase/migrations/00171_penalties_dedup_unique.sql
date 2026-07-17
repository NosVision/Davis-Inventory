-- 00171: stop stock penalties double-charging.
-- A double-submit (double-click / retry) could fan the SAME stock comparison out into two identical
-- penalty batches, charging every staff twice (seen on Upper House 2026-07: comparison M0060 → 2×20
-- rows = ฿12,000 instead of ฿6,000). Fix in two parts:
--   1) Void the duplicate rows already in the data — keep the earliest per (comparison, code, staff)
--      among non-cancelled rows, cancel the rest (audit-preserving; summary/SV already skip cancelled).
--   2) Add a partial unique index as a hard backstop so it can never happen again. The POST route also
--      guards this at the app layer, but the index protects against races and direct writes.

-- 1) Void existing duplicates (keep earliest).
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY comparison_id, penalty_code, staff_id
      ORDER BY created_at, id
    ) AS rn
  FROM penalties
  WHERE comparison_id IS NOT NULL
    AND status <> 'cancelled'
)
UPDATE penalties p
SET
  status = 'cancelled',
  notes = COALESCE(NULLIF(p.notes, ''), '') ||
          CASE WHEN COALESCE(p.notes, '') = '' THEN '' ELSE ' ' END ||
          '[auto-voided duplicate 00171]'
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1;

-- 2) Enforce one live penalty per (comparison, code, staff).
CREATE UNIQUE INDEX IF NOT EXISTS penalties_comparison_code_staff_uniq
  ON penalties (comparison_id, penalty_code, staff_id)
  WHERE comparison_id IS NOT NULL AND status <> 'cancelled';
