# Payroll Command Center + Store-Only Roster — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the payroll page the single place HR works a period — payroll figures beside each person's day-by-day attendance, editable in place with the numbers updating — and reduce the roster page to one thing: a per-store shift grid owned by store managers.

**Architecture:** No new engine. The timesheet strip on the payroll page reads the existing `/api/hr/timesheet` (same `computeDaySummary` the payrun uses, so the two cannot disagree), edits go through the existing `TimesheetEditModal` → `hr_timesheet_overrides` / `hr_leaves`, and "the money moves" is a re-POST of the existing payrun endpoint. The roster loses its company scope entirely; a new copy-month endpoint fills a month from the previous one by weekday pattern.

**Tech Stack:** Next.js 16 App Router · Supabase (Postgres + RLS) · TypeScript · Tailwind v4 · assert scripts in `scripts/hr-*-assert.cjs` (no vitest/jest in this repo) · Chrome DevTools MCP for E2E.

**Spec:** `docs/superpowers/specs/2026-08-28-payroll-command-center-design.md`

## Global Constraints

- **Money is satang (integer).** Never floats. Day counts are `numeric(3,1)` — halves are real.
- **Thai-first UI.** Pages carry self-contained `tt('ไทย','English')` strings or `next-intl`; follow whichever the file already uses.
- **Every HR mutation writes `hr_audit_log`** via `logHrAudit` — never a bare update.
- **Pay visibility is not optional.** Any route touching a payrun calls `refusePayrunIfHidden`; any employee-pay read goes through `payHiddenProfileIds` / `redactEmployeePay`. Mirrors SQL `pay_hidden_from_caller()`.
- **Finalized periods are locked.** `isDateInFinalizedPeriod` / `isRangeInFinalizedPeriod` gate any write that becomes a payroll input.
- **`hr_schedule` unique key is `(user_id, work_date)`** — one row per person per day, whatever the scope.
- **`user_stores` may be added to, never removed from.** A row also means "oversees this venue" on the stock side; removing one revokes stock access.
- **Verification gate:** `npx tsc --noEmit` after every edit; `npx next build` + `node scripts/hr-misc-assert.cjs` every 2–3 tasks; E2E at phase gates and immediately after any browser-only change (auth, RLS-visible, responsive, seed/DB-cleared) — per `kp-testing-cadence`.
- **E2E test bed:** store **HR Test Venue** (`HRTEST`) / company **HR Test Co** (5 active staff). Never assert against the four live companies.
- **Browser ownership ledger:** before any Chrome MCP round, `list_pages` and record pre-existing ids as NOT MINE into `.loop/owned.json`; close only ids you opened; never kill a dev server you did not start.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/00196_clear_demo_time_data.sql` | **create** — wipe demo attendance/roster/payruns; add May to Office |
| `src/lib/hr/schedule-copy.ts` | **create** — pure weekday-pattern copy rule (assert-able, no Supabase import) |
| `src/app/api/hr/schedule/copy-month/route.ts` | **create** — POST endpoint applying the rule |
| `src/app/(dashboard)/hr/schedule/page.tsx` | **modify** — copy-month button; remove company scope |
| `src/app/api/hr/schedule/route.ts` | **modify** — deprecate company scope on write, keep read |
| `src/components/hr/period-strip.tsx` | **create** — one person's day-by-day strip, click → callback |
| `src/app/(dashboard)/hr/payroll/page.tsx` | **modify** — expandable strip per register row + recompute-after-edit |
| `src/app/api/hr/payruns/route.ts` | **modify** — absence warning counts on the coverage payload |
| `scripts/hr-misc-assert.cjs` | **modify** — asserts for the copy rule |

---

### Task 1: Wipe demo time data and place May in the office

**Files:**
- Create: `supabase/migrations/00196_clear_demo_time_data.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: a database where `hr_attendance`, `hr_schedule`, `hr_timesheet_overrides`, `hr_payruns` and every payslip child table are empty, and May (`profiles.username='may'`) is a member of store `OFFICE`. Every later task's E2E assumes this baseline.

**Why the spec's "move 310 rows to store scope" is gone:** those rows are deleted here instead (owner decision 2026-08-28 — the time data is demo). Keep `hr_leaves`, `hr_leave_balances`, `hr_payroll_groups`, `hr_payroll_group_managers`, `user_permissions` — none of those are time data, and the leave rows back yesterday's quota feature.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply it and read the notices**

Apply via the Supabase MCP `apply_migration` (name `clear_demo_time_data`). The `raise exception`
guards fail the migration if anything survived — a silent partial wipe is the failure mode to avoid.

- [ ] **Step 3: Verify against production**

```sql
select (select count(*) from hr_attendance) att,
       (select count(*) from hr_schedule) sch,
       (select count(*) from hr_timesheet_overrides) ovr,
       (select count(*) from hr_payruns) runs,
       (select count(*) from hr_payslips) slips,
       (select count(*) from hr_leaves) leaves_kept,
       (select count(*) from hr_leave_balances) quotas_kept;
```
Expected: first five `0`, `leaves_kept = 19`, `quotas_kept = 20`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00196_clear_demo_time_data.sql
git commit -m "chore(hr): clear demo attendance, roster and payrun data; put May in the office"
```

---

### Task 2: The copy-month rule (pure logic + asserts)

**Files:**
- Create: `src/lib/hr/schedule-copy.ts`
- Modify: `scripts/hr-misc-assert.cjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface CopySourceRow { user_id: string; work_date: string; shift_template_id: string | null; is_day_off: boolean }`
  - `interface CopyTargetCell { user_id: string; work_date: string; shift_template_id: string | null; is_day_off: boolean }`
  - `function monthDates(month: string): string[]` — every `YYYY-MM-DD` in a `YYYY-MM`
  - `function buildCopyPlan(source: readonly CopySourceRow[], toMonth: string, skipUserIds: ReadonlySet<string>): CopyTargetCell[]`

**Rule:** for each person, per weekday (0=Sun…6=Sat), take the **most frequent** pattern that weekday had in the source month; ties break to the **latest** date. Apply it to every same-weekday date of the target month. People in `skipUserIds` (they already have rows in the target month) are omitted entirely — copying never overwrites.

- [ ] **Step 1: Write the failing asserts**

Append to `scripts/hr-misc-assert.cjs`, immediately before the `const fail = ...` line:

```js
// ── schedule-copy.ts: "use the same as last month" for rosters that repeat ──
// Copies by WEEKDAY, not by date: the 1st of one month is a Tuesday and of the next a Friday, so
// copying date-for-date would move everyone's day off.
const sc = load('schedule-copy.ts');
const T = 'tpl-day';
const src = [
  // Sep 2026: 1st = Tuesday. Two Mondays worked, one Monday off → Monday resolves to worked.
  { user_id: 'u1', work_date: '2026-09-07', shift_template_id: T, is_day_off: false },
  { user_id: 'u1', work_date: '2026-09-14', shift_template_id: T, is_day_off: false },
  { user_id: 'u1', work_date: '2026-09-21', shift_template_id: null, is_day_off: true },
  // Every Sunday off.
  { user_id: 'u1', work_date: '2026-09-06', shift_template_id: null, is_day_off: true },
  { user_id: 'u1', work_date: '2026-09-13', shift_template_id: null, is_day_off: true },
];
const plan = sc.buildCopyPlan(src, '2026-10', new Set());
const on = (d) => plan.find((c) => c.work_date === d);

eq('copy: October has 5 Mondays filled', plan.filter((c) => new Date(c.work_date + 'T00:00:00Z').getUTCDay() === 1).length, 4);
eq('copy: Monday takes the majority pattern (worked)', on('2026-10-05').is_day_off, false);
eq('copy: Sunday stays a day off', on('2026-10-04').is_day_off, true);
eq('copy: a weekday never seen in the source is not invented', on('2026-10-06'), undefined);
// Ties go to the later date — the most recent intention wins.
const tie = sc.buildCopyPlan([
  { user_id: 'u2', work_date: '2026-09-01', shift_template_id: T, is_day_off: false },
  { user_id: 'u2', work_date: '2026-09-08', shift_template_id: null, is_day_off: true },
], '2026-10', new Set());
eq('copy: a tie takes the later source date', tie.find((c) => c.work_date === '2026-10-06').is_day_off, true);
// Someone already rostered in the target month is skipped whole — copying must never overwrite.
eq('copy: skips people who already have rows', sc.buildCopyPlan(src, '2026-10', new Set(['u1'])).length, 0);
// Month lengths: February 2027 has 28 days, October 31.
eq('copy: month length 31', sc.monthDates('2026-10').length, 31);
eq('copy: month length 28', sc.monthDates('2027-02').length, 28);
eq('copy: month length 29 in a leap year', sc.monthDates('2028-02').length, 29);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/hr-misc-assert.cjs`
Expected: throws — `Cannot find module` / `schedule-copy.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/hr/schedule-copy.ts
/**
 * "Use the same as last month" for rosters that repeat — the office is the case that asked for it
 * (owner ask 2026-08-28): the same people, the same days, every month.
 *
 * Copies by WEEKDAY, never date-for-date. The 1st of one month is a Tuesday and of the next a
 * Friday; copying by date would slide everyone's day off across the week.
 *
 * Pure and import-free so scripts/hr-misc-assert.cjs can load it without a database.
 */

export interface CopySourceRow {
  user_id: string;
  work_date: string; // YYYY-MM-DD
  shift_template_id: string | null;
  is_day_off: boolean;
}

export interface CopyTargetCell {
  user_id: string;
  work_date: string;
  shift_template_id: string | null;
  is_day_off: boolean;
}

/** Every YYYY-MM-DD in a YYYY-MM, in order. */
export function monthDates(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) out.push(`${month}-${String(d).padStart(2, '0')}`);
  return out;
}

/** 0 = Sunday … 6 = Saturday, by UTC because these are calendar dates, not instants. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** What a cell holds, as a comparable key — two cells "agree" when this matches. */
function patternKey(row: CopySourceRow): string {
  return row.is_day_off ? 'off' : `shift:${row.shift_template_id ?? ''}`;
}

export function buildCopyPlan(
  source: readonly CopySourceRow[],
  toMonth: string,
  skipUserIds: ReadonlySet<string>
): CopyTargetCell[] {
  // user → weekday → pattern key → { count, latestDate, row }
  const byUser = new Map<string, Map<number, Map<string, { count: number; latest: string; row: CopySourceRow }>>>();
  for (const row of source) {
    if (skipUserIds.has(row.user_id)) continue;
    const days = byUser.get(row.user_id) ?? new Map();
    byUser.set(row.user_id, days);
    const wd = weekdayOf(row.work_date);
    const pats = days.get(wd) ?? new Map();
    days.set(wd, pats);
    const key = patternKey(row);
    const prev = pats.get(key);
    pats.set(key, {
      count: (prev?.count ?? 0) + 1,
      latest: prev && prev.latest > row.work_date ? prev.latest : row.work_date,
      row: prev && prev.latest > row.work_date ? prev.row : row,
    });
  }

  const dates = monthDates(toMonth);
  const out: CopyTargetCell[] = [];
  for (const [userId, days] of byUser) {
    for (const date of dates) {
      const pats = days.get(weekdayOf(date));
      if (!pats || pats.size === 0) continue; // that weekday never appeared in the source
      // Most frequent wins; a tie goes to whichever pattern was set later.
      let best: { count: number; latest: string; row: CopySourceRow } | null = null;
      for (const cand of pats.values()) {
        if (!best || cand.count > best.count || (cand.count === best.count && cand.latest > best.latest)) {
          best = cand;
        }
      }
      if (!best) continue;
      out.push({
        user_id: userId,
        work_date: date,
        shift_template_id: best.row.is_day_off ? null : best.row.shift_template_id,
        is_day_off: best.row.is_day_off,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the asserts**

Run: `node scripts/hr-misc-assert.cjs`
Expected: `ALL PASS`, total count risen by 9.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/hr/schedule-copy.ts scripts/hr-misc-assert.cjs
git commit -m "feat(hr): weekday-pattern rule for copying a roster month"
```

---

### Task 3: Copy-month endpoint

**Files:**
- Create: `src/app/api/hr/schedule/copy-month/route.ts`

**Interfaces:**
- Consumes: `buildCopyPlan`, `monthDates` (Task 2); `requireSchedulerForScope` from `@/lib/hr/route-auth`; `logHrAudit`.
- Produces: `POST /api/hr/schedule/copy-month` body `{ store_id: string; from_month: string; to_month: string }` → `{ data: { filled_cells: number; filled_people: number; skipped_people: number } }`.

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireSchedulerForScope } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { buildCopyPlan, monthDates, type CopySourceRow } from '@/lib/hr/schedule-copy';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * POST /api/hr/schedule/copy-month — fill a store's month from the month before it.
 *
 * The office works the same days every month and re-entering that by hand is the task this
 * removes (owner ask 2026-08-28). Never overwrites: anyone who already has a row in the target
 * month is skipped whole, so this is safe to press twice.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const fromMonth = typeof body.from_month === 'string' ? body.from_month : '';
  const toMonth = typeof body.to_month === 'string' ? body.to_month : '';

  if (!storeId) return NextResponse.json({ error: 'store_id is required' }, { status: 400 });
  if (!MONTH_RE.test(fromMonth) || !MONTH_RE.test(toMonth)) {
    return NextResponse.json({ error: 'from_month and to_month must be YYYY-MM' }, { status: 400 });
  }
  if (fromMonth === toMonth) {
    return NextResponse.json({ error: 'from_month and to_month must differ' }, { status: 400 });
  }

  const auth = await requireSchedulerForScope(storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const fromDates = monthDates(fromMonth);
  const toDates = monthDates(toMonth);

  const [srcRes, dstRes] = await Promise.all([
    service
      .from('hr_schedule')
      .select('user_id, work_date, shift_template_id, is_day_off')
      .eq('store_id', storeId)
      .gte('work_date', fromDates[0])
      .lte('work_date', fromDates[fromDates.length - 1]),
    service
      .from('hr_schedule')
      .select('user_id')
      .eq('store_id', storeId)
      .gte('work_date', toDates[0])
      .lte('work_date', toDates[toDates.length - 1]),
  ]);
  if (srcRes.error || dstRes.error) {
    return NextResponse.json({ error: 'Failed to read the roster' }, { status: 500 });
  }

  const skip = new Set((dstRes.data ?? []).map((r) => r.user_id as string));
  const plan = buildCopyPlan((srcRes.data ?? []) as CopySourceRow[], toMonth, skip);
  if (plan.length === 0) {
    return NextResponse.json({
      data: { filled_cells: 0, filled_people: 0, skipped_people: skip.size },
    });
  }

  // status 'draft' like every hand edit: a copied month still has to be published.
  const { error: insErr } = await service.from('hr_schedule').insert(
    plan.map((c) => ({
      store_id: storeId,
      company_id: null,
      user_id: c.user_id,
      work_date: c.work_date,
      shift_template_id: c.shift_template_id,
      is_day_off: c.is_day_off,
      status: 'draft',
      created_by: auth.userId,
    }))
  );
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const people = new Set(plan.map((c) => c.user_id));
  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: 'hr_schedule',
    recordId: storeId,
    before: null,
    after: { from_month: fromMonth, to_month: toMonth, cells: plan.length, people: people.size },
    reason: `คัดลอกตารางกะ ${fromMonth} → ${toMonth} (${people.size} คน ${plan.length} ช่อง)`,
  });

  return NextResponse.json({
    data: { filled_cells: plan.length, filled_people: people.size, skipped_people: skip.size },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/hr/schedule/copy-month/route.ts
git commit -m "feat(hr): copy a store roster month from the month before"
```

---

### Task 4: Copy-month button, and the roster becomes store-only

**Files:**
- Modify: `src/app/(dashboard)/hr/schedule/page.tsx`
- Modify: `src/app/api/hr/schedule/route.ts:357` (POST) — refuse new company-scope writes

**Interfaces:**
- Consumes: `POST /api/hr/schedule/copy-month` (Task 3).
- Produces: a roster page with no scope toggle. Later tasks assume `scopeKind` is gone and the page always sends `store_id`.

- [ ] **Step 1: Remove the scope toggle from the page**

Delete the `scopeKind` / `companyId` / `companies` state and the two-button `<span className="inline-flex rounded-md bg-gray-100 p-0.5 …">` block (around `page.tsx:446-467`), leaving the store `<select>` as the only scope control. Replace every `scopeQS` / `scopeBody` use with `store_id`. Keep the store `<select>` exactly as it is — `manageable-stores?capability=schedule` already returns only what the caller may schedule, so a store manager keeps seeing just their venue and HR sees all, office included.

- [ ] **Step 2: Add the copy button beside the month stepper**

```tsx
<Button
  size="sm"
  variant="outline"
  disabled={!storeId || busy}
  onClick={async () => {
    const prev = shiftMonth(month, -1);
    if (!(await confirm({
      title: tt(`ใช้ตารางเหมือน ${prev}?`, `Copy the roster from ${prev}?`),
      message: tt(
        'ระบบจะเติมตามรูปแบบวันในสัปดาห์ของเดือนก่อน และข้ามคนที่จัดตารางเดือนนี้ไว้แล้ว — ของเดิมไม่ถูกทับ',
        'Fills by last month’s weekday pattern and skips anyone already rostered this month — nothing is overwritten.'
      ),
      confirmLabel: tt('คัดลอก', 'Copy'),
    }))) return;
    const res = await fetch('/api/hr/schedule/copy-month', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId, from_month: prev, to_month: month }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { toast({ type: 'error', title: json?.error || tt('คัดลอกไม่สำเร็จ', 'Copy failed') }); return; }
    const d = json.data;
    toast({
      type: d.filled_cells > 0 ? 'success' : 'warning',
      title: d.filled_cells > 0
        ? tt(`เติมให้ ${d.filled_people} คน ${d.filled_cells} ช่อง`, `Filled ${d.filled_cells} cells for ${d.filled_people}`)
        : tt('ไม่มีอะไรให้เติม — ทุกคนจัดตารางเดือนนี้ไว้แล้ว หรือเดือนก่อนว่าง', 'Nothing to fill'),
      message: d.skipped_people > 0
        ? tt(`ข้าม ${d.skipped_people} คนที่จัดไว้แล้ว`, `Skipped ${d.skipped_people} already rostered`)
        : undefined,
    });
    await load();
  }}
>
  {tt('ใช้เหมือนเดือนที่แล้ว', 'Same as last month')}
</Button>
```

- [ ] **Step 3: Close the write path for company scope**

In `src/app/api/hr/schedule/route.ts` POST, after `parseScope`, refuse a company-scope write — reads stay so any legacy row still renders:

```ts
  // Rosters are per-store from 2026-08-28 (owner decision): the office is itself a store, so the
  // company scope no longer has a population of its own. Reads still accept it for legacy rows.
  if (scope.kind === 'company') {
    return NextResponse.json(
      { error: 'ตารางกะจัดเป็นรายสาขาเท่านั้น — เลือกสาขา (สำนักงานก็เป็นสาขาหนึ่ง)' },
      { status: 400 }
    );
  }
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npx next build`
Expected: both clean.

- [ ] **Step 5: E2E smoke — browser-only change (responsive + nav)**

Per `kp-testing-cadence`, a UI control was removed: run a targeted smoke now, do not wait for the gate.
1. `list_pages`; write pre-existing ids to `.loop/owned.json` as `notMine`.
2. Navigate to `/hr/schedule`, pick **HR Test Venue**, roster October 2026.
3. `evaluate_script`: assert no scope toggle remains —
   `document.body.innerText.includes('บริษัท') === false` within the header controls region.
4. Set one shift, press **ใช้เหมือนเดือนที่แล้ว** for November, assert the toast reports filled cells.
5. Press it again — assert it reports `ข้าม … คนที่จัดไว้แล้ว` and creates nothing new.
6. Close only pages you opened.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/hr/schedule/page.tsx" src/app/api/hr/schedule/route.ts
git commit -m "feat(hr): roster is per-store only, with a copy-last-month button"
```

---

### Task 5: The period strip component

**Files:**
- Create: `src/components/hr/period-strip.tsx`

**Interfaces:**
- Consumes: `DaySummary` from `@/components/hr/timesheet-parts`; the status derivation already written in `src/app/(dashboard)/hr/timesheet/_components/timesheet-views.tsx` (`deriveDayStatus`, `STYLE`) — **export those two from that file** rather than copying, so the roster grid and this strip cannot drift apart.
- Produces: `function PeriodStrip({ days, today, onPickDay, disabled }: { days: DaySummary[]; today: string; onPickDay: (businessDate: string) => void; disabled?: boolean })`.

- [ ] **Step 1: Export the shared status logic**

In `timesheet-views.tsx`, change `function deriveDayStatus` → `export function deriveDayStatus`, and `const STYLE` → `export const STYLE`.

- [ ] **Step 2: Write the component**

```tsx
'use client';

import { deriveDayStatus, STYLE } from '@/app/(dashboard)/hr/timesheet/_components/timesheet-views';
import type { DaySummary } from '@/components/hr/timesheet-parts';

/**
 * One person's period, day by day, sized to sit inside a payroll register row.
 *
 * Same glyphs and colours as the roster grid on purpose: HR should not have to learn a second
 * visual language for the same facts, and both read the same computeDaySummary the payrun does.
 */
export function PeriodStrip({
  days,
  today,
  onPickDay,
  disabled,
}: {
  days: DaySummary[];
  today: string;
  onPickDay: (businessDate: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="เวลาทำงานรายวัน">
      {days.map((d) => {
        const status = deriveDayStatus(d, today);
        const dayNum = Number(d.business_date.slice(8, 10));
        return (
          <button
            key={d.business_date}
            type="button"
            disabled={disabled}
            onClick={() => onPickDay(d.business_date)}
            title={`${d.business_date} · ${STYLE[status].label}${(d.late_min ?? 0) > 0 ? ` · สาย ${d.late_min} นาที` : ''}`}
            className={`h-7 w-7 rounded text-[10px] font-medium tabular-nums transition-opacity ${
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:opacity-80'
            } ${status === 'empty' ? 'border border-dashed border-gray-300 text-gray-400 dark:border-gray-600' : STYLE[status].block}`}
          >
            {dayNum}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/hr/period-strip.tsx "src/app/(dashboard)/hr/timesheet/_components/timesheet-views.tsx"
git commit -m "feat(hr): a per-person period strip sharing the roster's day language"
```

---

### Task 6: The command center — strip in the register, edit, recompute

**Files:**
- Modify: `src/app/(dashboard)/hr/payroll/page.tsx`

**Interfaces:**
- Consumes: `PeriodStrip` (Task 5); `TimesheetEditModal` + `EditTarget` + `LeaveTypeOption` from `src/app/(dashboard)/hr/timesheet/_components/timesheet-edit-modal`; `GET /api/hr/timesheet?company_id=&from=&to=`; `POST /api/hr/payruns` (recompute).
- Produces: nothing later tasks consume.

- [ ] **Step 1: Load the period's timesheet once per open payrun**

When `detail` changes, fetch `/api/hr/timesheet?company_id=<detail.payrun.company_id>&from=<cycle_start>&to=<cycle_end>` into `timesheetByUser: Map<string, DaySummary[]>`. Company scope, because the payrun is a company's — this is the same call `/hr/timesheet` makes in company mode, so the numbers are the payrun's own.

- [ ] **Step 2: Render the strip under an expanded register row**

The register already expands a row to show slip lines. Add above those lines:

```tsx
{timesheetByUser.get(row.user_id) && (
  <div className="mb-3 space-y-1.5">
    <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
      {tt('เวลาทำงานในงวดนี้ — คลิกวันเพื่อแก้', 'Attendance this period — click a day to edit')}
    </p>
    <PeriodStrip
      days={timesheetByUser.get(row.user_id)!}
      today={todayBangkok()}
      disabled={isFinalized || !canManageRun}
      onPickDay={(businessDate) => setEditTarget({ userId: row.user_id, name: row.name, day: timesheetByUser.get(row.user_id)!.find((d) => d.business_date === businessDate)! })}
    />
  </div>
)}
```

- [ ] **Step 3: Warn once per session before the first edit**

```tsx
// Editing here rewrites the employee's real attendance record, which they can see in their own
// app — not just a number on a slip. Said once, then trusted: warning on every cell would
// destroy the spreadsheet feel this screen exists to give back.
const [attendanceWarningSeen, setAttendanceWarningSeen] = useState(false);
const confirmAttendanceEdit = useCallback(async () => {
  if (attendanceWarningSeen) return true;
  const ok = await confirm({
    title: tt('แก้เวลาทำงานจริง', 'Editing real attendance'),
    message: tt(
      'การแก้ตรงนี้เขียนทับเวลาทำงานจริงของพนักงาน และพนักงานจะเห็นในแอปของเขาด้วย · ทุกการแก้ถูกบันทึกในประวัติ',
      'This rewrites the employee’s real attendance, visible in their own app. Every edit is audited.'
    ),
    confirmLabel: tt('เข้าใจแล้ว', 'Understood'),
  });
  if (ok) setAttendanceWarningSeen(true);
  return ok;
}, [attendanceWarningSeen, confirm, tt]);
```

Call it in `onPickDay` before opening the modal; abandon if it returns false.

- [ ] **Step 4: Recompute the draft after a successful edit**

`TimesheetEditModal` takes an `onSaved` callback. Wire it to:

```tsx
onSaved={async () => {
  setEditTarget(null);
  // A finalized run is locked and the API refuses the edit anyway; only a draft is worth redoing.
  if (detail && !isFinalized) {
    await regenerateCurrent();          // existing helper — re-POSTs /api/hr/payruns for this slice
    toast({ type: 'success', title: tt('อัปเดตยอดงวดแล้ว', 'Payrun totals updated') });
  }
  await reloadTimesheet();
}}
```

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npx next build && node scripts/hr-misc-assert.cjs`
Expected: all clean.

- [ ] **Step 6: E2E smoke — RLS-visible + data-shape change**

On **HR Test Co**: create an October payrun, expand a row, click a day, mark it ลา, save. Assert with
`evaluate_script` that (a) the strip cell changed colour, (b) the net figure in the register row
changed, (c) `hr_audit_log` gained a row (query via MCP). Then finalize the run and assert the strip
renders but every cell is disabled.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/hr/payroll/page.tsx"
git commit -m "feat(hr): edit attendance from the payroll register and see the money move"
```

---

### Task 7: Stop the silent cases

**Files:**
- Modify: `src/app/api/hr/payroll/coverage/route.ts`
- Modify: `src/app/(dashboard)/hr/payroll/_components/period-slices.tsx`
- Modify: `src/app/(dashboard)/hr/schedule/page.tsx`

**Interfaces:**
- Consumes: `payHiddenProfileIds` (already imported in the coverage route).
- Produces: `CoverageBucket.heavy_absence: { user_id: string; name: string; absent_days: number }[]` on the coverage payload.

**Why:** August 2026 produced a draft slip docking 18 days (−฿16,200) with nothing on screen saying so until the slip was opened. Both halves of that — a roster set for someone who never punches, and a period full of absence — now announce themselves.

- [ ] **Step 1: Add the absence count to each coverage bucket**

In the coverage route, for each bucket's members count days where the derived summary says `absent`, and attach anyone at 5+ days as `heavy_absence`. Reuse the `computeDaySummary` call the route already makes; do not add a second engine.

- [ ] **Step 2: Show it on the slice card**

```tsx
{b.heavy_absence.length > 0 && (
  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
    {tt(
      `${b.heavy_absence.length} คนมีวันขาด 5 วันขึ้นไปในงวดนี้ — เปิดดูก่อนปิดยอด`,
      `${b.heavy_absence.length} people have 5+ absent days this period — check before finalizing`
    )}{' '}
    <span className="opacity-80">{b.heavy_absence.slice(0, 4).map((h) => `${h.name} (${h.absent_days})`).join(' · ')}</span>
  </p>
)}
```

- [ ] **Step 3: Warn on the roster when scheduling someone who never punches**

The schedule GET already computes venue attachment from punches. Add `never_punched: string[]` (listed employees with no punch in the 90-day attachment window) and render:

```tsx
{neverPunched.length > 0 && (
  <div className="rounded-xl border border-amber-300 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/15 dark:text-amber-300">
    {tt(
      `${neverPunched.length} คนในตารางนี้ยังไม่เคยลงเวลาเลยใน 3 เดือน — กะที่ตั้งจะกลายเป็นวันขาดถ้าเขาไม่ตอกบัตร`,
      `${neverPunched.length} here have never clocked in for 3 months — rostered days become absences unless they punch`
    )}
  </div>
)}
```

- [ ] **Step 4: Typecheck, build, commit**

```bash
npx tsc --noEmit && npx next build
git add src/app/api/hr/payroll/coverage/route.ts "src/app/(dashboard)/hr/payroll/_components/period-slices.tsx" "src/app/(dashboard)/hr/schedule/page.tsx"
git commit -m "feat(hr): surface heavy absence before finalizing, and rosters for staff who never punch"
```

---

### Task 8: Phase-gate sweep on HR Test Venue

**Files:** none — verification only.

- [ ] **Step 1: Seed the test bed**

An empty database is not a test bed (`kp-testing-cadence`). On **HR Test Co / HR Test Venue** (5 active staff) create: an October 2026 roster (mixed shifts + days off), punches for two people, one approved leave, one absent day. Record every id created.

- [ ] **Step 2: Browser ownership ledger**

`list_pages` → write existing ids to `.loop/owned.json` under `notMine`. Start the dev server yourself and record its PID; if `:3000` is busy and not yours, use another port — never kill it.

- [ ] **Step 3: Sweep**

Roles: HR (`may`), a store manager (`hr-test-manager`), an HR user without confidential pay (`hr-test-hr`). Breakpoints 375 / 768 / 1440.

| Assert | Expected |
|---|---|
| Roster page, store manager | store select shows HR Test Venue only; no company control |
| Copy-last-month, pressed twice | second press fills 0 and reports skipped |
| Payroll register, HR | strip renders; clicking a day opens the modal |
| Edit a day → save | net figure changes; audit row exists |
| Finalize, then reopen the row | strip cells disabled with a reason |
| `hr-test-hr` on a restricted group's run | row hidden; no strip; actions disabled |
| Squeeze detector at 375 | no element under 140px wide wrapping to 3+ lines |

- [ ] **Step 4: Close what you opened**

Close only ids you recorded as yours; stop only the dev server PID you started. Report anything left open and whose it is.

- [ ] **Step 5: Final gate**

```bash
npx tsc --noEmit && npx next build && node scripts/hr-misc-assert.cjs
```

---

## Self-Review

**Spec coverage:** §3 Phase 0 → Task 1 (item 2 superseded by the wipe, noted in Task 1). Phase 1 → Tasks 2–3, button in Task 4. Phase 2 → Task 4. Phase 3 → Tasks 5–6. Phase 4 → Task 7. §7 test plan → Tasks 4/6/8. §4 D1 resolved by the wipe; D2 resolved — button lives on the roster page only.

**Type consistency:** `CopySourceRow` / `CopyTargetCell` / `buildCopyPlan` / `monthDates` are defined in Task 2 and consumed unchanged in Task 3. `PeriodStrip` props in Task 5 match the call in Task 6. `deriveDayStatus` / `STYLE` are exported in Task 5 Step 1 before Task 5 Step 2 imports them.

**Open risk carried into execution:** Task 6 Step 1 assumes `/api/hr/timesheet` accepts `company_id` + `from` + `to` and returns per-user `DaySummary[]` — confirmed present in `src/app/api/hr/timesheet/route.ts:121-133`, but the exact response envelope must be read before writing the fetch.
