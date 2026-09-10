-- Attendance must pass the server-side policy, roster and abuse checks.
-- Removing the self-insert policy and grant prevents direct Data API bypasses;
-- service_role retains its existing server insert privileges and RLS bypass.
drop policy if exists hr_attendance_insert on public.hr_attendance;
revoke insert on table public.hr_attendance from authenticated;
