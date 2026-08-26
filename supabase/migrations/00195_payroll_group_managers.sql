-- 00195_payroll_group_managers.sql
-- Per-group payroll ownership (owner ask 2026-08-26).
--
-- Until now "who may see whose pay" had exactly one switch: hr_employees.pay_confidential, lifted
-- by the GLOBAL can_view_confidential_pay grant. That works while one company has one secret
-- slice. It does not survive the second: the whole point of payroll groups is that two HR users
-- each own a slice, and a global grant cannot say "May sees ทีมบัญชี, Ploy sees ทีมบาร์".
--
-- This adds the missing axis. A payroll group with managers listed here is RESTRICTED: only its
-- managers (plus can_view_confidential_pay holders) may see its members' pay figures. A group with
-- no managers listed behaves exactly as today — any HR user may run it. Nothing has to be assigned
-- for payroll to keep working, and "ยังไม่จัดกลุ่ม" can never be restricted because it is the
-- absence of a group, not a group.
--
-- The rule is still "hide the NUMBERS, not the PERSON" (00182): a restricted group's members stay
-- fully visible for leave, scheduling and attendance, or the other HR user could not do their job
-- for them at all.
--
-- Deliberately NOT gated by group membership: the company-wide statutory documents
-- (ภ.ง.ด.1 / สปส. / ทะเบียนค่าจ้าง / ใบ 50 ทวิ / ภ.ง.ด.1ก). They must list EVERY employee of the
-- company across every group, so there is no partial version to hand a single group's manager. If
-- group managers could satisfy that gate, a company with two restricted groups would have NOBODY
-- able to file its taxes. They stay on can_view_confidential_pay, which is therefore the
-- "may see everyone's pay" grant — and the screens now say so.

create table if not exists public.hr_payroll_group_managers (
  group_id uuid not null references public.hr_payroll_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

comment on table public.hr_payroll_group_managers is
  'HR users who own a payroll group. A group with at least one row here is restricted: only these users (plus can_view_confidential_pay holders) may see its members'' pay. A group with no rows is open to any HR user, exactly as before this table existed.';

-- The PK covers (group_id, user_id); the reverse direction is what the visibility predicate hits
-- on every row it tests ("is THIS caller a manager of that group").
create index if not exists idx_hr_payroll_group_managers_user
  on public.hr_payroll_group_managers (user_id);

alter table public.hr_payroll_group_managers enable row level security;

-- Any HR user may READ who owns a group — that is the whole point of putting the names on screen.
create policy "hr_payroll_group_managers_select" on public.hr_payroll_group_managers
  for select to authenticated using (can_manage_hr());

-- But only a can_view_confidential_pay holder may CHANGE the list. If any HR user could, the lock
-- would be decorative: delete May's row, and ทีมบัญชี is open to you a second later. The grant that
-- already sees every salary is the one that decides who else does.
create policy "hr_payroll_group_managers_write" on public.hr_payroll_group_managers
  for all to authenticated
  using (can_view_confidential_pay())
  with check (can_view_confidential_pay());

-- ---------------------------------------------------------------------------
-- The single visibility predicate, shared by RLS and (mirrored in) the app
-- ---------------------------------------------------------------------------
-- Takes the two employee columns rather than an employee id so a policy can call it from a row it
-- has already joined, without a second lookup per row.
create or replace function public.pay_hidden_from_caller(
  p_pay_confidential boolean,
  p_payroll_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- can_view_confidential_pay() is owner-or-grant and outranks everything: it is the grant that
    -- files the company's taxes, and those filings list every employee anyway.
    not public.can_view_confidential_pay()
    and (
      coalesce(p_pay_confidential, false)
      or (
        p_payroll_group_id is not null
        and exists (
          select 1 from public.hr_payroll_group_managers m
          where m.group_id = p_payroll_group_id
        )
        and not exists (
          select 1 from public.hr_payroll_group_managers m
          where m.group_id = p_payroll_group_id and m.user_id = auth.uid()
        )
      )
    );
$$;

comment on function public.pay_hidden_from_caller is
  'True when the calling user may NOT see the pay of an employee with these two columns. Hidden if the employee is flagged pay_confidential, or sits in a payroll group that has managers the caller is not one of. can_view_confidential_pay() holders (owner included) are never blocked.';

-- profiles.id of every employee whose pay is hidden from the caller. profile_id IS NULL for staff
-- with no login yet — excluded, because a NULL inside a `not in (...)` set makes the whole
-- predicate NULL and would hide every payslip from everyone.
create or replace function public.pay_hidden_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.profile_id
  from public.hr_employees e
  where e.profile_id is not null
    and public.pay_hidden_from_caller(e.pay_confidential, e.payroll_group_id);
$$;

comment on function public.pay_hidden_profile_ids is
  'profiles.id of every employee whose pay figures are hidden from the calling user. Empty for can_view_confidential_pay() holders.';

-- ---------------------------------------------------------------------------
-- Re-point the two policies that gated on pay_confidential alone
-- ---------------------------------------------------------------------------
-- Payslips: an HR user who owns neither the flag-grant nor the group cannot read the slip at all.
-- The employee's own row (finalized payruns) is untouched — people always see their own pay.
drop policy if exists "hr_payslips_select" on public.hr_payslips;
create policy "hr_payslips_select" on public.hr_payslips
  for select to authenticated
  using (
    (
      can_manage_hr()
      and hr_payslips.user_id not in (select public.pay_hidden_profile_ids())
    )
    or (user_id = (select auth.uid()) and hr_payrun_is_finalized(payrun_id))
  );

-- The audit log stores before/after payloads verbatim, salary included — the quietest way around
-- the whole feature if left open. Same predicate, matched on either key the log records under.
drop policy if exists "hr_audit_log_select" on public.hr_audit_log;
create policy "hr_audit_log_select" on public.hr_audit_log
  for select to authenticated
  using (
    can_manage_hr()
    and (
      can_view_confidential_pay()
      or not exists (
        select 1 from public.hr_employees e
        where (
                (hr_audit_log.table_name = 'hr_employees' and hr_audit_log.record_id = e.id)
                or hr_audit_log.record_id = e.profile_id
              )
          and public.pay_hidden_from_caller(e.pay_confidential, e.payroll_group_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Carry the one group that already exists
-- ---------------------------------------------------------------------------
-- "ทีมบัญชี" has been May's slice since 00186 and has four finalized runs behind it. Leaving it
-- unmanaged would read as "open to every HR user" — the opposite of why it was created.
insert into public.hr_payroll_group_managers (group_id, user_id)
select g.id, p.id
from public.hr_payroll_groups g
cross join public.profiles p
where g.name = 'ทีมบัญชี'
  and p.username = 'may'
on conflict (group_id, user_id) do nothing;
