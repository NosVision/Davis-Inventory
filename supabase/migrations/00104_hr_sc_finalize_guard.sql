-- P4.1 review HIGH/MED: enforce the finalize lock ATOMICALLY at the DB level (the app-layer
-- SELECT-then-write checks have a race window across the 5 SC write endpoints), and prevent
-- concurrent-recompute duplicate auto lines.

-- Block any INSERT/UPDATE/DELETE on allocations/deductions whose parent pool is finalized.
CREATE OR REPLACE FUNCTION hr_sc_alloc_guard() RETURNS trigger AS $$
DECLARE st TEXT;
BEGIN
  SELECT status INTO st FROM hr_sc_pools WHERE id = COALESCE(NEW.pool_id, OLD.pool_id);
  IF st = 'finalized' THEN
    RAISE EXCEPTION 'SC pool is finalized' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION hr_sc_ded_guard() RETURNS trigger AS $$
DECLARE st TEXT;
BEGIN
  SELECT p.status INTO st
  FROM hr_sc_pools p JOIN hr_sc_allocations a ON a.pool_id = p.id
  WHERE a.id = COALESCE(NEW.allocation_id, OLD.allocation_id);
  IF st = 'finalized' THEN
    RAISE EXCEPTION 'SC pool is finalized' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hr_sc_allocations_guard ON hr_sc_allocations;
CREATE TRIGGER hr_sc_allocations_guard
  BEFORE INSERT OR UPDATE OR DELETE ON hr_sc_allocations
  FOR EACH ROW EXECUTE FUNCTION hr_sc_alloc_guard();

DROP TRIGGER IF EXISTS hr_sc_deductions_guard ON hr_sc_deductions;
CREATE TRIGGER hr_sc_deductions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON hr_sc_deductions
  FOR EACH ROW EXECUTE FUNCTION hr_sc_ded_guard();

-- One auto line per (allocation, source_type, source_ref) — a concurrent double-recompute
-- can otherwise interleave delete/insert and double-deduct.
CREATE UNIQUE INDEX IF NOT EXISTS hr_sc_deductions_auto_uniq
  ON hr_sc_deductions (allocation_id, source_type, source_ref)
  WHERE auto = true;
