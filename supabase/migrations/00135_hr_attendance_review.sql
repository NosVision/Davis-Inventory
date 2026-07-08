-- §F attendance geofence enforcement (owner 2026-07-08): a punch that lands OUTSIDE every
-- assigned store's geofence, or is flagged VPN/GPS-spoof suspect, is no longer silently accepted.
-- It is recorded but HELD as `review_status='pending'` for HR to approve/reject. Both the employee
-- (their punch is pending) and HR (a punch needs review) are notified from the API.
ALTER TABLE hr_attendance
  ADD COLUMN IF NOT EXISTS review_status text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text;

-- null = no review needed (inside geofence / undeterminable). Otherwise the review lifecycle.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_attendance_review_status_chk') THEN
    ALTER TABLE hr_attendance
      ADD CONSTRAINT hr_attendance_review_status_chk
      CHECK (review_status IS NULL OR review_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- Fast lookup of the HR "needs review" queue.
CREATE INDEX IF NOT EXISTS idx_hr_attendance_review_pending
  ON hr_attendance (business_date) WHERE review_status = 'pending';
