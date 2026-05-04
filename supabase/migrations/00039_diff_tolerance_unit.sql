-- Add absolute (unit) tolerance alongside the existing percent tolerance.
-- A comparison row is auto-approved if EITHER:
--   |difference|       <= diff_tolerance_unit  (units, e.g. 0.4 bottle)
--   |diff_percent|     <= diff_tolerance       (percent, e.g. 5%)
-- This handles the case where small absolute differences (e.g. 1 vs 0.6)
-- produce large percentages but represent rounding/measurement noise.

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS diff_tolerance_unit NUMERIC(10,4) DEFAULT 0.4;

UPDATE store_settings
  SET diff_tolerance_unit = 0.4
  WHERE diff_tolerance_unit IS NULL;

COMMENT ON COLUMN store_settings.diff_tolerance_unit IS
  'Absolute unit tolerance for stock comparison. Auto-approve when |difference| <= this OR |diff_percent| <= diff_tolerance.';
