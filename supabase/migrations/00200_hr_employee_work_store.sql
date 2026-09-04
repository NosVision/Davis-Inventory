-- 00200: "สาขาที่ทำงาน" — HR's own answer to which venue an employee works at, separate from the
-- venue access `user_stores` grants (owner ask 2026-09-04).
--
-- `user_stores` carries two different claims in one table: "oversees / can see this venue's data"
-- (its meaning in the deposit and stock modules it came from) and "works at this venue" (what HR
-- read it as). For 129 of 133 employees the two agree — one row, one venue, no ambiguity. For the
-- four head-office staff they do not: HR, purchasing and two accountants hold 5–6 rows each purely
-- so they can see every venue's deposits and stock, and every attempt to guess a workplace out of
-- that has been wrong in a different way.
--
--   • membership alone put the accounting team on five venues' timesheets and rosters, and into
--     five venues' payroll subtotals at once (owner report 2026-08-17);
--   • roster/punch evidence (migration 00189), which replaced it, then filed two of them under the
--     venue they happened to be rostered at and left the two who never punch attached to no venue
--     at all — so they read as missing from their own team (owner report 2026-09-04).
--
-- So HR gets a field instead of an inference. `work_store_id`, when set, decides alone: that person
-- is listed on that venue's HR surfaces and no other, whatever `user_stores` says. Access is
-- untouched — nothing here reads or changes who may see a venue, so head office keeps every venue
-- it had.
--
-- NULL is the normal state and keeps today's behaviour exactly: a single-venue member is always
-- listed at their venue, and a genuinely multi-venue worker still follows roster/punch evidence.
-- The field is for the case evidence cannot answer, not a flag every hire must carry — a hand-set
-- value on 133 people would rot the moment someone transfers and nobody remembers to change it.

alter table public.hr_employees
  add column if not exists work_store_id uuid references public.stores(id) on delete set null;

comment on column public.hr_employees.work_store_id is
  'สาขาที่ทำงานจริง (ไม่เกี่ยวกับสิทธิ์เข้าถึงสาขาใน user_stores); NULL = ให้ระบบดูจากตารางเวร/การสแกนตามเดิม';

-- Every HR surface that lists a venue's staff filters on this, so it is read once per page load.
create index if not exists hr_employees_work_store_idx
  on public.hr_employees (work_store_id)
  where work_store_id is not null;

-- ── Backfill: everyone attached to สำนักงาน (OFFICE) ────────────────────────
-- Written as the rule rather than a list of ids so it says WHY these rows. OFFICE is not a venue
-- that runs shifts — it is the office — so a member of it works at the office, full stop. That is
-- the whole back-office team, including the four the owner named on 2026-09-04 (HR, purchasing,
-- two accountants) and the six colleagues whose evidence already pointed at OFFICE.
--
-- Setting it for the six changes no screen today; it makes them durable. The failure this migration
-- exists to end came from a rule that read `user_stores`, and `user_stores` moves for reasons that
-- have nothing to do with where someone sits — three of these four had their venue access edited
-- mid-investigation, which under the old rule would have silently moved them between venues.
--
-- Idempotent: re-running only ever re-sets the same rows to the same value.
update public.hr_employees e
set work_store_id = (select id from public.stores where store_code = 'OFFICE')
where e.work_store_id is null
  and e.status in ('active', 'probation')
  and exists (
    select 1 from public.user_stores us
    join public.stores s on s.id = us.store_id
    where us.user_id = e.profile_id and s.store_code = 'OFFICE'
  );
