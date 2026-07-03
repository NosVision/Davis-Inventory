-- P3.1 reconcile: leave types & holidays are non-sensitive config that ESS employees
-- must be able to read to file leave and view the holiday calendar. Original 00092
-- restricted SELECT to can_manage_hr(); relax to any authenticated (write stays HR-only).
DROP POLICY IF EXISTS hr_leave_types_read_policy ON hr_leave_types;
CREATE POLICY hr_leave_types_read_policy ON hr_leave_types
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS hr_holidays_read_policy ON hr_holidays;
CREATE POLICY hr_holidays_read_policy ON hr_holidays
  FOR SELECT TO authenticated USING (true);
