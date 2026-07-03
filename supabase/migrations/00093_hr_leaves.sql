-- HR Leave Requests (P3.1b)
-- Part of Davis Inventory HR System
-- §E: Employee leave requests with approval workflow

-- Leaves Table
-- Stores employee leave requests (ลา) with approval workflow
CREATE TABLE IF NOT EXISTS hr_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL, -- Store context (derived from hr_schedule, nullable for company-wide leave)
  company_id UUID NOT NULL REFERENCES hr_companies(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES hr_leave_types(id),
  from_date DATE NOT NULL,
  to_date DATE NOT NULL CHECK (to_date >= from_date),
  days NUMERIC(5,1) NOT NULL CHECK (days > 0), -- Calculated days (can be 0.5 for half-day)
  reason TEXT NOT NULL,
  cert_path TEXT, -- Medical certificate path (private hr-documents bucket)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approver_id UUID REFERENCES profiles(id), -- Manager/HR who approved/rejected
  decided_at TIMESTAMPTZ, -- Decision timestamp
  decision_note TEXT, -- Reason for rejection/approval note
  -- Overridden fields (when HR manually adjusts timesheet for leave days)
  worked_min_override INT,
  late_min_override INT,
  ot_min_override INT,
  absent_override BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

-- Indexes for lookups
CREATE INDEX IF NOT EXISTS hr_leaves_user_status ON hr_leaves(user_id, status, from_date DESC);
CREATE INDEX IF NOT EXISTS hr_leaves_store_status ON hr_leaves(store_id, status, from_date DESC);
CREATE INDEX IF NOT EXISTS hr_leaves_company_status ON hr_leaves(company_id, status, from_date DESC);
CREATE INDEX IF NOT EXISTS hr_leaves_dates ON hr_leaves(from_date, to_date);
CREATE INDEX IF NOT EXISTS hr_leaves_leave_type ON hr_leaves(leave_type_id);

-- Partial unique index: One pending leave request per user per date range
-- Prevents overlapping pending leave requests (overlap guard)
CREATE UNIQUE INDEX IF NOT EXISTS hr_leaves_no_overlap_pending
  ON hr_leaves(user_id, from_date, to_date)
  WHERE status = 'pending';

-- RLS Policies
ALTER TABLE hr_leaves ENABLE ROW LEVEL SECURITY;

-- Read: Own leaves OR store managers (can_manage_store) OR HR (can_manage_hr)
CREATE POLICY hr_leaves_read_policy ON hr_leaves
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR can_manage_hr()
    OR EXISTS (
      SELECT 1 FROM hr_manager_scopes
      WHERE user_id = auth.uid()
        AND store_id = hr_leaves.store_id
    )
  );

-- Insert: Authenticated users can insert their own leave requests
CREATE POLICY hr_leaves_insert_policy ON hr_leaves
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Update: Owner can cancel pending; HR/managers can decide (approve/reject)
CREATE POLICY hr_leaves_update_policy ON hr_leaves
  FOR UPDATE
  TO authenticated
  USING (
    -- Employee can cancel their own pending requests
    (user_id = auth.uid() AND status = 'pending' AND status IN ('cancelled'))
    -- OR HR/managers can decide (approve/reject with approver_id set)
    OR (can_manage_hr() OR EXISTS (
      SELECT 1 FROM hr_manager_scopes
      WHERE user_id = auth.uid()
        AND store_id = hr_leaves.store_id
    ))
  )
  WITH CHECK (
    -- Employee can cancel their own pending requests
    (user_id = auth.uid() AND status = 'pending' AND status IN ('cancelled'))
    -- OR HR/managers can decide (approve/reject with approver_id set)
    OR (can_manage_hr() OR EXISTS (
      SELECT 1 FROM hr_manager_scopes
      WHERE user_id = auth.uid()
        AND store_id = hr_leaves.store_id
    ))
  );

-- Delete: No direct deletes (use status = 'cancelled' instead for audit trail)
CREATE POLICY hr_leaves_delete_policy ON hr_leaves
  FOR DELETE
  TO authenticated
  USING (false);

-- Updated_at trigger
CREATE TRIGGER hr_leaves_updated_at BEFORE UPDATE ON hr_leaves
  FOR EACH ROW EXECUTE FUNCTION hr_leave_types_holidays_updated_at();
