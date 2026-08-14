-- 00186_assign_accounting_payroll_group.sql
-- One-off data fix, applied to production 2026-08-14.
--
-- Puts the ten confidential-pay staff of บริษัท ทรัพย์สินตระการตา into the "ทีมบัญชี" payroll group
-- so May can run their payroll as its own slice, with nobody else's figures mixed in (owner ask
-- 2026-08-11, done on request 2026-08-14).
--
-- She could not do it from the screen: the employee form loaded its dropdowns once on mount, so
-- the group she had just created was not in the list and could not be picked. The save then went
-- through with the field empty, which read as a broken save — she created and deleted the group
-- four times before reporting it. Fixed in the same push as this migration; this closes the
-- assignment that was owed.
--
-- Selected by the flag, not by a list of names: pay_confidential is what defines this group today,
-- and matching on it means the two cannot drift apart here. The other eight in the company are bar
-- staff, are not flagged, and stay ungrouped — which is the whole point of the split.
--
-- Idempotent: re-running matches nothing, because payroll_group_id is no longer null.

do $$
declare
  v_group_id uuid;
  v_company_id uuid;
  v_actor uuid;
  v_count int;
begin
  select id, company_id into v_group_id, v_company_id
  from public.hr_payroll_groups
  where name = 'ทีมบัญชี'
  order by created_at desc
  limit 1;

  if v_group_id is null then
    raise notice 'No "ทีมบัญชี" payroll group found — nothing assigned.';
    return;
  end if;

  -- Attributed to May: it is her group and her payroll slice, and the audit trail should say so
  -- rather than pointing at a nameless system action.
  select id into v_actor from public.profiles where username = 'may' limit 1;

  -- Audit first, from the rows still holding their old value.
  insert into public.hr_audit_log (actor_id, action, table_name, record_id, before, after, reason)
  select v_actor,
         'update',
         'hr_employees',
         e.id,
         jsonb_build_object('payroll_group_id', e.payroll_group_id),
         jsonb_build_object('payroll_group_id', v_group_id),
         'จัดเข้ากลุ่มเงินเดือน "ทีมบัญชี" (พนักงานที่ติดธงข้อมูลเงินเดือนเป็นความลับ)'
  from public.hr_employees e
  where e.company_id = v_company_id
    and e.pay_confidential = true
    and e.payroll_group_id is null
    and e.status in ('active', 'probation');

  update public.hr_employees e
  set payroll_group_id = v_group_id,
      updated_by = coalesce(v_actor, e.updated_by)
  where e.company_id = v_company_id
    and e.pay_confidential = true
    and e.payroll_group_id is null
    and e.status in ('active', 'probation');

  get diagnostics v_count = row_count;
  raise notice 'Assigned % employees to payroll group %', v_count, v_group_id;
end $$;
