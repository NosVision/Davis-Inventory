#!/usr/bin/env node
/**
 * One-off repair for the "future rostered day counted as ขาดงาน" bug (fixed in code by 8cda00c).
 *
 * Before the fix, `absent = scheduled && !first_in` had no "has this day closed yet?" guard, so a
 * published roster made every UPCOMING day read as an unauthorised absence. That flag reaches money
 * in three places — the salary dock, the travel-allowance dock, and the Service-Charge dock — so
 * rows already written to the DB carry the inflated numbers even now that the engine is correct.
 *
 * This script rewrites those rows using the SAME rule the fixed engine now applies:
 *   • hr_payslips (+ their absent / travel_absent lines) of every DRAFT payrun
 *   • the auto SC deduction lines of every DRAFT pool (via the app's own recomputePoolDeductions)
 *   • the `service_charge` earning of a draft payslip whose N−1 pool just changed
 *
 * FINALIZED payruns/pools are never touched — money there has been paid and reopening is an HR
 * decision, not a script's. Any finalized row that looks affected is REPORTED instead.
 *
 *   node scripts/fix-future-absence.cjs            # dry run — prints every diff, writes nothing
 *   node scripts/fix-future-absence.cjs --apply    # write
 *
 * Idempotent: a second run finds nothing to change.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const Module = require('module');

const repo = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [repo] })).config({ path: path.join(repo, '.env.local') });

// ── Run the app's own TypeScript modules in-process (same trick as the offline asserts, plus
// the '@/…' path alias) so the repair uses the real engine rather than a re-implementation.
const SRC = path.join(repo, 'src');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) {
    const base = path.join(SRC, request.slice(2));
    for (const cand of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(cand)) return origResolve.call(this, cand, ...rest);
    }
  }
  return origResolve.call(this, request, ...rest);
};
require.extensions['.ts'] = (mod, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: 'commonjs', target: 'es2020', esModuleInterop: true },
  }).outputText;
  mod._compile(out, filename);
};

const { computeDaySummary, applyOverride } = require(path.join(SRC, 'lib/hr/time-engine.ts'));
const { classifyLeaveEffect, enumerateDates } = require(path.join(SRC, 'lib/hr/leaves.ts'));
const { businessDateBangkok } = require(path.join(SRC, 'lib/utils/date.ts'));
const { recomputePoolDeductions } = require(path.join(SRC, 'lib/hr/sc-recompute.ts'));

const APPLY = process.argv.includes('--apply');
const CLOSED_THROUGH = businessDateBangkok();

const { createClient } = require(require.resolve('@supabase/supabase-js', { paths: [repo] }));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const baht = (satang) => (satang / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
const daysOf = (ref) => {
  const m = /^(\d+(?:\.\d+)?)d$/.exec(String(ref ?? ''));
  return m ? Number(m[1]) : null;
};

async function sel(table, build) {
  const { data, error } = await build(db.from(table));
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

/** Correct unauthorised-absent day count for one employee over one cycle (mirrors the payrun route). */
function absentDaysFor(ctx, emp) {
  const uid = emp.profile_id;
  const days = ctx.dates.map((date) => {
    const cell = ctx.schedule.get(`${uid}|${date}`);
    const derived = computeDaySummary({
      businessDate: date,
      shift: cell?.shift ?? null,
      isDayOff: cell?.is_day_off ?? false,
      hasSchedule: !!cell,
      punches: ctx.punches.get(`${uid}|${date}`) ?? [],
      workHoursPerDay: Number(emp.work_hours_per_day) || 8,
      otEligible: emp.ot_eligible ?? false,
      closedThrough: CLOSED_THROUGH,
    });
    return applyOverride(derived, ctx.overrides.get(`${uid}|${date}`));
  });

  const empStart = emp.start_date && emp.start_date > ctx.start ? emp.start_date : ctx.start;
  const empEnd = emp.end_date && emp.end_date < ctx.end ? emp.end_date : ctx.end;
  const inWindow = (d) => d >= empStart && d <= empEnd;

  const leaveCovered = new Set();
  for (const lv of ctx.leaves.get(uid) ?? []) {
    const from = lv.from_date < ctx.start ? ctx.start : lv.from_date;
    const to = lv.to_date > ctx.end ? ctx.end : lv.to_date;
    for (const d of enumerateDates(from, to)) if (!ctx.holidays.has(d)) leaveCovered.add(d);
  }
  return days.filter((d) => d.absent && !leaveCovered.has(d.business_date) && inWindow(d.business_date)).length;
}

async function repairPayruns() {
  const payruns = await sel('hr_payruns', (q) =>
    q.select('id, company_id, store_id, period_year, period_month, cycle_start, cycle_end, status')
  );
  let changed = 0;
  let blocked = 0;

  for (const run of payruns) {
    const slips = await sel('hr_payslips', (q) =>
      q.select('id, user_id, employee_id, rate_satang, pay_type, gross_satang, total_deduction_satang, net_satang').eq('payrun_id', run.id)
    );
    if (!slips.length) continue;

    const start = run.cycle_start;
    const end = run.cycle_end;
    const userIds = slips.map((s) => s.user_id);
    const empIds = slips.map((s) => s.employee_id).filter(Boolean);

    const [company, employees, schedule, attendance, overrides, leaves, leaveTypes, holidays] = await Promise.all([
      sel('hr_companies', (q) => q.select('id, day_divisor').eq('id', run.company_id)).then((r) => r[0]),
      sel('hr_employees', (q) =>
        q.select('id, profile_id, work_hours_per_day, ot_eligible, start_date, end_date').in('id', empIds.length ? empIds : ['00000000-0000-0000-0000-000000000000'])
      ),
      sel('hr_schedule', (q) =>
        q.select('user_id, work_date, is_day_off, shift:hr_shift_templates(start_time, end_time)').in('user_id', userIds).gte('work_date', start).lte('work_date', end)
      ),
      sel('hr_attendance', (q) =>
        q.select('user_id, type, ts, business_date').in('user_id', userIds).gte('business_date', start).lte('business_date', end)
          .or('review_status.is.null,review_status.neq.rejected')
      ),
      sel('hr_timesheet_overrides', (q) =>
        q.select('user_id, business_date, worked_min, late_min, ot_min, absent, reason').in('user_id', userIds).gte('business_date', start).lte('business_date', end)
      ),
      sel('hr_leaves', (q) =>
        q.select('id, user_id, leave_type_id, from_date, to_date, cert_path').in('user_id', userIds).eq('status', 'approved').lte('from_date', end).gte('to_date', start)
      ),
      sel('hr_leave_types', (q) => q.select('id, code, paid, paid_with_cert, deduct_sc, deduct_travel')),
      sel('hr_holidays', (q) => q.select('holiday_date').eq('company_id', run.company_id).eq('active', true)),
    ]);

    const ctx = {
      start,
      end,
      dates: enumerateDates(start, end),
      schedule: new Map(schedule.map((s) => [`${s.user_id}|${s.work_date}`, { ...s, shift: Array.isArray(s.shift) ? s.shift[0] : s.shift }])),
      punches: new Map(),
      overrides: new Map(overrides.map((o) => [`${o.user_id}|${o.business_date}`, o])),
      leaves: new Map(),
      holidays: new Set(holidays.map((h) => h.holiday_date)),
    };
    for (const a of attendance) {
      const k = `${a.user_id}|${a.business_date}`;
      ctx.punches.set(k, [...(ctx.punches.get(k) ?? []), { type: a.type, ts: a.ts }]);
    }
    for (const lv of leaves) ctx.leaves.set(lv.user_id, [...(ctx.leaves.get(lv.user_id) ?? []), lv]);
    const empById = new Map(employees.map((e) => [e.id, e]));
    const dayDiv = Number(company?.day_divisor) || 30;

    for (const slip of slips) {
      const lines = await sel('hr_payslip_deductions', (q) =>
        q.select('id, type, amount_satang, ref').eq('payslip_id', slip.id).in('type', ['absent', 'travel_absent', 'travel_leave'])
      );
      const absentLine = lines.find((l) => l.type === 'absent');
      const travelLine = lines.find((l) => l.type === 'travel_absent');
      const storedDays = daysOf(absentLine?.ref) ?? daysOf(travelLine?.ref) ?? 0;
      if (storedDays === 0) continue;

      const emp = empById.get(slip.employee_id);
      if (!emp) {
        console.log(`  ! payslip ${slip.id}: employee row missing — skipped`);
        continue;
      }
      const correctDays = absentDaysFor(ctx, emp);
      if (correctDays === storedDays) continue;

      const label = `${run.period_year}-${String(run.period_month).padStart(2, '0')} ${slip.user_id.slice(0, 8)}`;
      if (run.status === 'finalized') {
        blocked++;
        console.log(`  ! FINALIZED payrun ${run.id} · ${label}: absent ${storedDays}d → should be ${correctDays}d (NOT touched — reopen is an HR decision)`);
        continue;
      }

      // Same arithmetic as the engine: salary ÷day_divisor × days; travel ÷day_divisor × days,
      // capped by what the leave dock already took out of the same allowance.
      const partTime = String(slip.pay_type).startsWith('pt_');
      const newAbsent = partTime ? 0 : Math.round((Number(slip.rate_satang) / dayDiv) * correctDays);
      const travelEarn = await sel('hr_payslip_earnings', (q) =>
        q.select('amount_satang').eq('payslip_id', slip.id).eq('type', 'allowance').eq('ref', 'travel')
      );
      const travelAllowance = travelEarn.reduce((s, e) => s + Number(e.amount_satang), 0);
      const travelAlreadyDocked = lines.filter((l) => l.type === 'travel_leave').reduce((s, l) => s + Number(l.amount_satang), 0);
      const newTravel = travelAllowance > 0 && correctDays > 0
        ? Math.max(0, Math.min(Math.round((travelAllowance / dayDiv) * correctDays), travelAllowance - travelAlreadyDocked))
        : 0;

      const delta = (newAbsent - Number(absentLine?.amount_satang ?? 0)) + (newTravel - Number(travelLine?.amount_satang ?? 0));
      changed++;
      console.log(
        `  · ${label}: absent ${storedDays}d → ${correctDays}d · salary dock ${baht(Number(absentLine?.amount_satang ?? 0))} → ${baht(newAbsent)}` +
        ` · travel dock ${baht(Number(travelLine?.amount_satang ?? 0))} → ${baht(newTravel)} · net ${baht(slip.net_satang)} → ${baht(slip.net_satang - delta)}`
      );
      if (!APPLY) continue;

      for (const [line, amount, type] of [[absentLine, newAbsent, 'absent'], [travelLine, newTravel, 'travel_absent']]) {
        if (line && amount <= 0) {
          const { error } = await db.from('hr_payslip_deductions').delete().eq('id', line.id);
          if (error) throw new Error(`delete ${type}: ${error.message}`);
        } else if (line) {
          const { error } = await db.from('hr_payslip_deductions').update({ amount_satang: amount, ref: `${correctDays}d` }).eq('id', line.id);
          if (error) throw new Error(`update ${type}: ${error.message}`);
        }
      }
      const { error: upErr } = await db
        .from('hr_payslips')
        .update({
          total_deduction_satang: Number(slip.total_deduction_satang) + delta,
          net_satang: Number(slip.net_satang) - delta,
        })
        .eq('id', slip.id);
      if (upErr) throw new Error(`update payslip: ${upErr.message}`);
    }
  }
  return { changed, blocked };
}

/**
 * Rebuild the auto SC lines of every DRAFT pool through the app's own routine, then refresh the
 * `service_charge` earning of any DRAFT payslip whose N−1 pool moved (SC is excluded from net, so
 * only the slip's gross and that one line change).
 */
async function repairScPools() {
  const pools = await sel('hr_sc_pools', (q) => q.select('id, period_month, status'));
  let changed = 0;

  for (const pool of pools) {
    const before = await sel('hr_sc_deductions', (q) =>
      q.select('id, source_type, label, amount_satang, allocation_id, hr_sc_allocations!inner(pool_id)').eq('hr_sc_allocations.pool_id', pool.id)
    ).catch(() => null);
    const allocs = await sel('hr_sc_allocations', (q) => q.select('id, user_id, allocated_satang').eq('pool_id', pool.id));
    const allocIds = allocs.map((a) => a.id);
    const priorLines = allocIds.length
      ? await sel('hr_sc_deductions', (q) => q.select('id, allocation_id, source_type, label, amount_satang').in('allocation_id', allocIds))
      : [];
    void before;

    const suspect = priorLines.filter((l) => l.source_type === 'absent');
    if (pool.status === 'finalized') {
      if (suspect.length) console.log(`  ! FINALIZED pool ${pool.id} (${pool.period_month}) has ${suspect.length} absent line(s) — left alone`);
      continue;
    }
    if (!allocIds.length) continue;

    if (!APPLY) {
      for (const l of suspect) console.log(`  · pool ${pool.period_month}: would recompute "${l.label}" (${baht(l.amount_satang)})`);
      if (suspect.length) changed += suspect.length;
      continue;
    }

    await recomputePoolDeductions(db, pool.id, null);
    const after = await sel('hr_sc_deductions', (q) => q.select('id, allocation_id, source_type, label, amount_satang').in('allocation_id', allocIds));
    const sum = (rows) => rows.reduce((s, r) => s + Number(r.amount_satang), 0);
    if (sum(after) !== sum(priorLines)) {
      changed++;
      console.log(`  · pool ${pool.period_month}: deductions ${baht(sum(priorLines))} → ${baht(sum(after))}`);
    }

    // The pool feeds the FOLLOWING month's payslips (N−1 rule).
    const [y, m] = pool.period_month.split('-').map(Number);
    const nextYear = m === 12 ? y + 1 : y;
    const nextMonth = m === 12 ? 1 : m + 1;
    const netByUser = new Map();
    for (const a of allocs) {
      const ded = after.filter((d) => d.allocation_id === a.id).reduce((s, d) => s + Math.max(0, Number(d.amount_satang)), 0);
      netByUser.set(a.user_id, (netByUser.get(a.user_id) ?? 0) + Math.max(0, Number(a.allocated_satang) - ded));
    }
    const runs = await sel('hr_payruns', (q) => q.select('id, status').eq('period_year', nextYear).eq('period_month', nextMonth));
    for (const run of runs) {
      if (run.status === 'finalized') continue;
      const slips = await sel('hr_payslips', (q) => q.select('id, user_id, gross_satang').eq('payrun_id', run.id));
      for (const slip of slips) {
        const want = netByUser.get(slip.user_id);
        if (want === undefined) continue;
        const line = (await sel('hr_payslip_earnings', (q) => q.select('id, amount_satang').eq('payslip_id', slip.id).eq('type', 'service_charge')))[0];
        const have = Number(line?.amount_satang ?? 0);
        if (have === want) continue;
        console.log(`  · SC on ${nextYear}-${String(nextMonth).padStart(2, '0')} payslip ${slip.id.slice(0, 8)}: ${baht(have)} → ${baht(want)}`);
        changed++;
        if (line && want <= 0) {
          await db.from('hr_payslip_earnings').delete().eq('id', line.id);
        } else if (line) {
          await db.from('hr_payslip_earnings').update({ amount_satang: want }).eq('id', line.id);
        } else {
          await db.from('hr_payslip_earnings').insert({ payslip_id: slip.id, type: 'service_charge', label: 'service_charge', amount_satang: want, sort: 90 });
        }
        await db.from('hr_payslips').update({ gross_satang: Number(slip.gross_satang) - have + want }).eq('id', slip.id);
      }
    }
  }
  return changed;
}

(async () => {
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — last closed business date = ${CLOSED_THROUGH}\n`);
  console.log('Payslips (draft payruns):');
  const { changed, blocked } = await repairPayruns();
  console.log(`  → ${changed} payslip(s) ${APPLY ? 'repaired' : 'would change'}${blocked ? `, ${blocked} finalized left alone` : ''}\n`);
  console.log('Service Charge pools:');
  const scChanged = await repairScPools();
  console.log(`  → ${scChanged} change(s) ${APPLY ? 'applied' : 'pending'}\n`);
  if (!APPLY) console.log('Nothing was written. Re-run with --apply to commit these changes.');
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
