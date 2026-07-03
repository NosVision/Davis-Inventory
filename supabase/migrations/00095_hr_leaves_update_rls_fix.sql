-- P3.1 reconcile: 00093 update policy had contradictory logic
-- (status='pending' AND status IN ('cancelled') is always false), so the employee
-- self-cancel branch was dead. Split USING (pre-image) vs WITH CHECK (post-image).
DROP POLICY IF EXISTS hr_leaves_update_policy ON hr_leaves;
CREATE POLICY hr_leaves_update_policy ON hr_leaves
  FOR UPDATE
  TO authenticated
  USING (
    (user_id = auth.uid() AND status = 'pending')
    OR can_manage_hr()
    OR EXISTS (
      SELECT 1 FROM hr_manager_scopes s
      WHERE s.user_id = auth.uid() AND s.store_id = hr_leaves.store_id
    )
  )
  WITH CHECK (
    (user_id = auth.uid() AND status = 'cancelled')
    OR can_manage_hr()
    OR EXISTS (
      SELECT 1 FROM hr_manager_scopes s
      WHERE s.user_id = auth.uid() AND s.store_id = hr_leaves.store_id
    )
  );
