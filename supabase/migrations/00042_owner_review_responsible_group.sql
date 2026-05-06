-- ============================================================================
-- 00042_owner_review_responsible_group.sql
--
-- Owner review: let the responsible-staff dropdown also represent
-- "all staff" or "all bar" as a collective owner of a discrepancy.
-- We add a sibling enum-like column rather than overloading the
-- responsible_staff_id FK with sentinel UUIDs — keeps the FK clean,
-- query-friendly, and lets the UI render either as a text label.
-- ============================================================================

ALTER TABLE public.comparisons
  ADD COLUMN IF NOT EXISTS responsible_group TEXT
    CHECK (responsible_group IN ('staff_all', 'bar_all'));

COMMENT ON COLUMN public.comparisons.responsible_group IS
  'Set when the discrepancy is owned by an entire role (staff_all or bar_all) instead of one person; mutually exclusive with responsible_staff_id.';
