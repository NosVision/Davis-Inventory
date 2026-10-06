-- Evaluate per-request RLS helpers once per statement instead of once per row.
--
-- Policies called is_admin(), get_user_role(), can_manage_hr(),
-- can_view_confidential_pay() and auth.uid() bare, so Postgres re-ran them for
-- every candidate row whose first OR arm was false (staff reading
-- hr_attendance: ~38 ms → ~0.6 ms per query, warm; can_manage_hr() runs two
-- sub-selects per row). Wrapping a call as ( SELECT fn() ) turns it into an
-- InitPlan that runs once.
--
-- Semantics are unchanged: every wrapped function is STABLE, takes no
-- arguments and depends only on auth.uid(), which is fixed for the statement.
-- Only USING / WITH CHECK text is rewritten; roles, command and
-- permissive/restrictive flags stay as they are.
--
-- Rollback: the original expressions are saved in
-- ops.rls_policy_backup_20261006 (schema not exposed through the API).

set local lock_timeout = '3s';

create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

create table if not exists ops.rls_policy_backup_20261006 as
  select schemaname, tablename, policyname, cmd, qual, with_check, now() as saved_at
    from pg_policies
   where schemaname = 'public';

do $$
declare
  fn_re  constant text := '(?<!SELECT )\m(public\.)?(is_admin|get_user_role|can_manage_hr|can_view_confidential_pay)\(\)';
  uid_re constant text := '(?<!SELECT )\mauth\.uid\(\)';
  p record;
  new_qual text;
  new_check text;
  stmt text;
begin
  for p in
    with pol as materialized (
      select schemaname, tablename, policyname, qual, with_check
        from pg_policies
       where schemaname = 'public'
    )
    select * from pol
     where coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ fn_re
        or coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ uid_re
  loop
    new_qual := regexp_replace(
      regexp_replace(p.qual, fn_re, '( SELECT \1\2() AS \2)', 'g'),
      uid_re, '( SELECT auth.uid() AS uid)', 'g');
    new_check := regexp_replace(
      regexp_replace(p.with_check, fn_re, '( SELECT \1\2() AS \2)', 'g'),
      uid_re, '( SELECT auth.uid() AS uid)', 'g');

    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if p.qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if p.with_check is not null then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;
    execute stmt;
  end loop;
end $$;
