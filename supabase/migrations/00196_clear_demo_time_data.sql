-- 00196_clear_demo_time_data.sql
-- The attendance / roster / payrun data in production is demo: 50 punches across 6 people, 413
-- roster rows, and 20 payruns whose six "finalized" ones hold 15 slips between them — not a month
-- of 131 staff. May is about to work the real thing, so it starts empty (owner call 2026-08-28).
--
-- Deliberately KEPT: hr_leaves + hr_leave_balances (the quota feature shipped 2026-08-27 reads
-- them, and one pending request is a live test of "pending counts"), payroll groups and their
-- managers, and user_permissions. None of those are time data.
-- Untouched by definition: hr_imported_payslips — the real Jan–Jun payroll history, another table.

do $$
declare v_att int; v_sch int; v_ovr int; v_run int; v_slip int;
begin
  select count(*) into v_att  from public.hr_attendance;
  select count(*) into v_sch  from public.hr_schedule;
  select count(*) into v_ovr  from public.hr_timesheet_overrides;
  select count(*) into v_run  from public.hr_payruns;
  select count(*) into v_slip from public.hr_payslips;
  raise notice 'before: attendance=% schedule=% overrides=% payruns=% payslips=%',
    v_att, v_sch, v_ovr, v_run, v_slip;
end $$;

-- Children first: only hr_payslips→payrun cascades are unverified, so be explicit everywhere.
update public.hr_attendance_requests set target_attendance_id = null
  where target_attendance_id is not null;
update public.hr_document_requests set payslip_id = null where payslip_id is not null;

delete from public.hr_payslip_print_requests;
delete from public.hr_payslip_deductions;
delete from public.hr_payslip_earnings;
delete from public.hr_payslip_bonuses;
delete from public.hr_payslip_tax_overrides;
delete from public.hr_payrun_review_links;
delete from public.hr_payrun_remarks;
delete from public.hr_payrun_adjustments;
delete from public.hr_payslips;
delete from public.hr_payruns;

delete from public.hr_timesheet_overrides;
delete from public.hr_schedule;
delete from public.hr_attendance;

-- May works at the office but was never a member of it: she is attached to five VENUES (which on
-- the stock side means "oversees"), so the office roster could not list her. Additive only —
-- removing a user_stores row would revoke her stock access to that venue.
insert into public.user_stores (user_id, store_id)
select p.id, s.id
from public.profiles p, public.stores s
where p.username = 'may' and s.store_code = 'OFFICE'
on conflict do nothing;

do $$
declare v_att int; v_sch int; v_run int; v_may int;
begin
  select count(*) into v_att from public.hr_attendance;
  select count(*) into v_sch from public.hr_schedule;
  select count(*) into v_run from public.hr_payruns;
  select count(*) into v_may from public.user_stores us
    join public.profiles p on p.id = us.user_id
    join public.stores s on s.id = us.store_id
    where p.username = 'may' and s.store_code = 'OFFICE';
  raise notice 'after: attendance=% schedule=% payruns=% may_in_office=%', v_att, v_sch, v_run, v_may;
  if v_att <> 0 or v_sch <> 0 or v_run <> 0 then
    raise exception 'clear incomplete: attendance=% schedule=% payruns=%', v_att, v_sch, v_run;
  end if;
  if v_may <> 1 then raise exception 'May was not added to OFFICE (got %)', v_may; end if;
end $$;
