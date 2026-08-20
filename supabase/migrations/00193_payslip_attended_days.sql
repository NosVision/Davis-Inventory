-- hr_payslips.attended_days — recorded days that were NOT covered by approved leave.
--
-- worked_days counts every day with a time record (a punch, or an HR override crediting minutes).
-- That deliberately includes a day someone punched while on approved leave, which is right for pay
-- — a part-timer who turns up is paid for the day, and leave is never paid to them separately — but
-- it reads wrong on a slip: one employee's August showed 7 recorded days when only 5 were actual
-- attendance, the other two being an approved ลากิจ and ลาป่วย she also punched on (2026-08-20).
--
-- Stored rather than derived so the split comes from the payrun's own `days` + leaveCovered, the
-- same values the absence count is built from. Deriving it in a read path would mean writing the
-- "what counts as a recorded day" rule a second time, which is exactly how the SV month drifted.
--
-- NULL on slips generated before this column existed — the payslip view falls back to showing the
-- single total, so old slips are unaffected until their run is regenerated.
ALTER TABLE hr_payslips ADD COLUMN IF NOT EXISTS attended_days NUMERIC;

COMMENT ON COLUMN hr_payslips.attended_days IS
  'Days with a time record that were NOT covered by approved leave. worked_days minus this is the '
  'number of leave days the person also clocked on. NULL = generated before the column existed.';
