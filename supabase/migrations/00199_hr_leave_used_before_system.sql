-- 00199: "ใช้ไปก่อนเข้าระบบ" — leave days a person had already taken this year before the app
-- ever recorded a leave request (owner report 2026-09-02, via May).
--
-- The quota grid counted ONLY hr_leaves rows, and the first real ones were filed in July 2026.
-- Everything taken in Jan–Jun 2026 lives in the imported payroll slips (hr_imported_payslips.leaves
-- — VL/SL/PL = พักร้อน/ลาป่วย/ลากิจ), which nothing read. So 16 people who had already spent their
-- vacation — นางสาวศิริพร 7 วัน, three more at the full 6 — were shown as "0/6", i.e. still entitled
-- to the whole year. Same undercount on sick and personal leave.
--
-- The sheet's per-person "พักร้อนคงเหลือ (สิ้นสุด 31 ธ.ค. 69)" column that migration 00165/00166
-- imported is the YEAR'S ENTITLEMENT, not a running remainder (owner confirmed 2026-09-02) — so the
-- quota numbers already in hr_leave_balances are right; only the "used" side was missing.
--
--   effective quota  = hr_leave_balances.quota_days ?? hr_leave_types.annual_quota_days
--   used             = used_before_system_days + Σ approved hr_leaves.days of that type in the year
--
-- quota_days becomes NULLable so a row can carry ONLY the opening used-days without pinning an
-- entitlement — a pinned copy would stop following hr_leave_types.annual_quota_days if HR ever
-- changes the company default.

alter table public.hr_leave_balances
  alter column quota_days drop not null,
  add column if not exists used_before_system_days numeric(5,1) not null default 0
    check (used_before_system_days >= 0 and used_before_system_days <= 366);

alter table public.hr_pending_leave_balances
  alter column quota_days drop not null,
  add column if not exists used_before_system_days numeric(5,1) not null default 0
    check (used_before_system_days >= 0 and used_before_system_days <= 366);

comment on column public.hr_leave_balances.used_before_system_days is
  'วันลาที่ใช้ไปแล้วก่อนระบบเริ่มบันทึกใบลา (ปีเดียวกัน) — นับรวมเป็น used ทุกหน้าจอ';
comment on column public.hr_leave_balances.quota_days is
  'โควตาเฉพาะคน; NULL = ใช้ hr_leave_types.annual_quota_days ของบริษัทนั้น';

-- ── Backfill from the imported slips ────────────────────────────────────────
-- Only VL/SL/PL are mapped: they are the three codes with a quota to spend. VLX/SLX/PLX are 0 in
-- every imported 2026 row; H (นักขัตฤกษ์) and LWP/SLW (ลาไม่รับค่าจ้าง) map to types with no quota,
-- so counting them would change nothing and would invent grid columns for unlimited types.
--
-- No double-count risk: the imported slips stop at มิ.ย. 2026 and the only hr_leaves rows before
-- 1 ก.ค. 2026 belong to test accounts, which have no imported slips.

with legacy as (
  select ip.employee_id,
         ip.period_year as year,
         k.code,
         sum(coalesce((ip.leaves ->> k.src)::numeric, 0)) as days
  from public.hr_imported_payslips ip
  cross join (values ('vl', 'vacation'), ('sl', 'sick'), ('pl', 'personal')) as k(src, code)
  where ip.employee_id is not null
  group by 1, 2, 3
  having sum(coalesce((ip.leaves ->> k.src)::numeric, 0)) > 0
)
insert into public.hr_leave_balances
  (employee_id, leave_type_id, year, quota_days, used_before_system_days, note)
select l.employee_id, lt.id, l.year, null, l.days,
       'backfill 00199: วันลาที่ใช้ไปก่อนเข้าระบบ (สลิปเงินเดือน ม.ค.–มิ.ย. ' || l.year || ')'
from legacy l
join public.hr_employees e on e.id = l.employee_id
join lateral (
  select t.id from public.hr_leave_types t
  where t.code = l.code and t.company_id = e.company_id
  order by t.created_at
  limit 1
) lt on true
on conflict (employee_id, leave_type_id, year) do update
  set used_before_system_days = excluded.used_before_system_days,
      updated_at = now();

-- Same numbers for people who are still only an imported identity (no app account yet): stage them
-- so they land automatically when the person registers (src/lib/hr/leave-balance-link.ts).
with legacy_pending as (
  select ip.pending_identity_id,
         ip.period_year as year,
         k.code,
         sum(coalesce((ip.leaves ->> k.src)::numeric, 0)) as days
  from public.hr_imported_payslips ip
  cross join (values ('vl', 'vacation'), ('sl', 'sick'), ('pl', 'personal')) as k(src, code)
  where ip.employee_id is null and ip.pending_identity_id is not null
  group by 1, 2, 3
  having sum(coalesce((ip.leaves ->> k.src)::numeric, 0)) > 0
)
insert into public.hr_pending_leave_balances
  (pending_identity_id, leave_type_code, year, quota_days, used_before_system_days, note)
select p.pending_identity_id, p.code, p.year, null, p.days,
       'backfill 00199: วันลาที่ใช้ไปก่อนเข้าระบบ (สลิปเงินเดือน ม.ค.–มิ.ย. ' || p.year || ')'
from legacy_pending p
on conflict (pending_identity_id, leave_type_code, year) do update
  set used_before_system_days = excluded.used_before_system_days
  where public.hr_pending_leave_balances.consumed_at is null;
