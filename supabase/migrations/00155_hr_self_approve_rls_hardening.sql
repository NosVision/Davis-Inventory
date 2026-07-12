-- 00155_hr_self_approve_rls_hardening.sql
-- Close the self-approval holes on employee-facing request tables.
--
-- Before: the RLS on hr_leaves (INSERT), hr_ot_requests and hr_attendance_requests
-- (INSERT + UPDATE) only checked `user_id = auth.uid()` with NO status constraint. A staffer
-- could therefore issue a direct PostgREST call to INSERT an already-'approved' leave, or
-- UPDATE their own OT / attendance-correction row to status='approved' + set decided_ot_min —
-- self-approving their own money without any manager.
--
-- After: on the SELF path an employee may only create a row as 'pending', and may only leave
-- their own still-'pending' row as 'pending' or 'cancelled' (i.e. edit or cancel it, never
-- approve/reject it). Managers/HR (`can_manage_store`) keep full control, and the app's own
-- approval routes run through the service-role client (RLS bypassed), so no legitimate flow
-- changes. Status domain for all three tables: pending | approved | rejected | cancelled.

-- ---------------------------------------------------------------------------
-- hr_leaves
-- ---------------------------------------------------------------------------
drop policy if exists hr_leaves_insert_policy on public.hr_leaves;
create policy hr_leaves_insert_policy on public.hr_leaves
  for insert to authenticated
  with check (
    (user_id = (select auth.uid()) and status = 'pending')
    or public.can_manage_store(store_id)
  );

-- ---------------------------------------------------------------------------
-- hr_ot_requests
-- ---------------------------------------------------------------------------
drop policy if exists hr_ot_requests_insert on public.hr_ot_requests;
create policy hr_ot_requests_insert on public.hr_ot_requests
  for insert to authenticated
  with check (
    (user_id = (select auth.uid()) and status = 'pending')
    or public.can_manage_store(store_id)
  );

drop policy if exists hr_ot_requests_update on public.hr_ot_requests;
create policy hr_ot_requests_update on public.hr_ot_requests
  for update to authenticated
  using (
    public.can_manage_store(store_id)
    or (user_id = (select auth.uid()) and status = 'pending')
  )
  with check (
    public.can_manage_store(store_id)
    or (user_id = (select auth.uid()) and status in ('pending', 'cancelled'))
  );

-- ---------------------------------------------------------------------------
-- hr_attendance_requests
-- ---------------------------------------------------------------------------
drop policy if exists hr_attendance_requests_insert on public.hr_attendance_requests;
create policy hr_attendance_requests_insert on public.hr_attendance_requests
  for insert to authenticated
  with check (
    (user_id = (select auth.uid()) and status = 'pending')
    or public.can_manage_store(store_id)
  );

drop policy if exists hr_attendance_requests_update on public.hr_attendance_requests;
create policy hr_attendance_requests_update on public.hr_attendance_requests
  for update to authenticated
  using (
    public.can_manage_store(store_id)
    or (user_id = (select auth.uid()) and status = 'pending')
  )
  with check (
    public.can_manage_store(store_id)
    or (user_id = (select auth.uid()) and status in ('pending', 'cancelled'))
  );
