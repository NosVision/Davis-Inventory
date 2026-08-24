import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyLeaveEffect, enumerateDates } from '@/lib/hr/leaves';
import { getHrPolicies } from '@/lib/hr/policy';
import {
  computeWarningScDeduction,
  computeLeaveScDeduction,
  computeCarryScDeduction,
} from '@/lib/hr/service-charge';
import { reconcilePoolDeductions } from '@/lib/hr/sc-reconcile';
import { businessDateBangkok, toBangkokISO } from '@/lib/utils/date';
import { scEventCycleForPool, scPoolMonthForDate } from '@/lib/hr/pay-cycle';

const POOL = 'hr_sc_pools';
const ALLOC = 'hr_sc_allocations';
const DED = 'hr_sc_deductions';

function prevMonthFirst(periodMonth: string): string {
  const [y, m] = periodMonth.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}-01`;
}
function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function clampMax(a: string, b: string): string { return a > b ? a : b; }
function clampMin(a: string, b: string): string { return a < b ? a : b; }

interface WarningRow { id: string; level: string; sc_deduct_percent: number | null; amount_satang: number | null }
interface LeaveTypeEffect { code: string; paid: boolean; paid_with_cert: boolean; deduct_sc: boolean; deduct_travel: boolean }
interface LeaveRow {
  id: string; from_date: string; to_date: string; cert_path: string | null;
  leave_type: LeaveTypeEffect | LeaveTypeEffect[] | null;
}

/**
 * Rebuild the AUTO SC deduction lines (warnings + leave + prior-month carry) for every allocation in
 * a DRAFT pool, then reconcile the shared-balance deferral (§H). Extracted from the recompute route
 * so it can also run AUTOMATICALLY when allocations are saved and at finalize — so a store's prior
 * carry flows forward without HR having to press "Recompute" (and chains month-to-month on its own).
 *
 * Idempotent. No-op on a finalized pool. Throws on any DB error (never deletes auto lines without
 * re-inserting) so callers can surface a 500.
 */
export async function recomputePoolDeductions(
  service: SupabaseClient,
  poolId: string,
  actorId: string | null,
): Promise<void> {
  const policies = await getHrPolicies(service);

  const { data: pool, error: poolErr } = await service
    .from(POOL)
    .select('id, store_id, period_month, status')
    .eq('id', poolId)
    .maybeSingle();
  if (poolErr) throw poolErr;
  if (!pool) throw new Error('Pool not found');
  if ((pool.status as string) === 'finalized') return; // locked — nothing to recompute

  const storeId = pool.store_id as string;
  const poolMonth = pool.period_month as string; // 'YYYY-MM-01' — the month this pool PAYS in

  // The window every deduction below is measured over: the PAYROLL CYCLE before the pool pays —
  // 26th of M−2 through 25th of M−1.
  //
  // It was the previous calendar month until 2026-08-24. That was already an improvement on
  // docking a pool for its own month (which took money back after it had been transferred on the
  // 15th), but it left one payslip carrying two spans that overlapped without matching: salary on
  // 26th→25th, the SV beside it on 1st→month end. HR could not tell which span a given ขาด count
  // came from, and the difference read as the system disagreeing with itself.
  //
  // The client's own process was the payroll cycle from the start — they take the deductions off
  // last month's payroll file, and that file runs 26th→25th. The 15th is only the day the money
  // moves, never a period boundary. So salary and SV now sit end to end: what you were absent for
  // docks that cycle's salary, and the same cycle's SV one transfer later.
  const cycle = scEventCycleForPool(poolMonth);
  const periodStart = cycle.start;
  const periodEnd = cycle.end;
  const periodStartTs = `${periodStart}T00:00:00+07:00`;
  const nextStartTs = `${nextDay(periodEnd)}T00:00:00+07:00`;

  // Carry still chains pool to pool: what last month's pool could not absorb lands on this one.
  const prevStart = prevMonthFirst(poolMonth);
  const { data: prevPool, error: prevPoolErr } = await service
    .from(POOL)
    .select('id')
    .eq('store_id', storeId)
    .eq('period_month', prevStart)
    .maybeSingle();
  if (prevPoolErr) throw prevPoolErr;

  const { data: allocs, error: allocErr } = await service
    .from(ALLOC)
    .select('id, user_id, allocated_satang')
    .eq('pool_id', poolId);
  if (allocErr) throw allocErr;

  for (const alloc of allocs ?? []) {
    const allocId = alloc.id as string;
    const userId = alloc.user_id as string;
    const allocated = Number(alloc.allocated_satang) || 0;
    const lines: Record<string, unknown>[] = [];

    // Fetch sources first (fail before any delete) so a failed query can never understate deductions.
    const { data: warnings, error: warnErr } = await service
      .from('hr_warnings')
      .select('id, level, sc_deduct_percent, amount_satang')
      .eq('user_id', userId)
      .in('status', ['active', 'acknowledged'])
      .gte('issued_at', periodStartTs)
      .lt('issued_at', nextStartTs);
    if (warnErr) throw warnErr;
    for (const w of (warnings ?? []) as unknown as WarningRow[]) {
      const { amount_satang, carry_satang } = computeWarningScDeduction(allocated, {
        level: w.level, sc_deduct_percent: w.sc_deduct_percent, amount_satang: w.amount_satang,
      });
      if (amount_satang > 0 || carry_satang > 0) {
        lines.push({ allocation_id: allocId, source_type: 'warning', source_ref: w.id, label: `Warning: ${w.level}`, amount_satang, carry_satang, auto: true, created_by: actorId });
      }
    }

    if (prevPool && policies.warning_carry_enabled) {
      const { data: prevAlloc, error: prevAllocErr } = await service
        .from(ALLOC).select('id').eq('pool_id', prevPool.id as string).eq('user_id', userId).maybeSingle();
      if (prevAllocErr) throw prevAllocErr;
      if (prevAlloc) {
        const CARRY_FAMILIES = [
          { sources: ['warning', 'warning_carry'], outType: 'warning_carry', label: 'Warning carry (prev month)' },
          { sources: ['eval', 'eval_carry'], outType: 'eval_carry', label: 'Evaluation carry (prev month)' },
          { sources: ['stock_penalty', 'stock_penalty_carry'], outType: 'stock_penalty_carry', label: 'Stock penalty carry (prev month)' },
        ];
        for (const fam of CARRY_FAMILIES) {
          const { data: prevCarryRows, error: prevCarryErr } = await service
            .from(DED).select('carry_satang').eq('allocation_id', prevAlloc.id as string).in('source_type', fam.sources).gt('carry_satang', 0);
          if (prevCarryErr) throw prevCarryErr;
          const priorCarry = (prevCarryRows ?? []).reduce((s, d) => s + (Number(d.carry_satang) || 0), 0);
          const { amount_satang, carry_satang } = computeCarryScDeduction(allocated, priorCarry);
          if (amount_satang > 0 || carry_satang > 0) {
            lines.push({ allocation_id: allocId, source_type: fam.outType, source_ref: prevPool.id, label: fam.label, amount_satang, carry_satang, auto: true, created_by: actorId });
          }
        }
      }
    }

    const { data: sched, error: schedErr } = await service
      .from('hr_schedule').select('work_date, is_day_off')
      .eq('user_id', userId).eq('store_id', storeId)
      .gte('work_date', periodStart).lte('work_date', periodEnd);
    if (schedErr) throw schedErr;
    const dayOffSet = new Set<string>();
    const rosteredSet = new Set<string>(); // scheduled to WORK (is_day_off = false)
    for (const r of sched ?? []) {
      const d = r.work_date as string;
      if (r.is_day_off === true) dayOffSet.add(d);
      else rosteredSet.add(d);
    }

    const { data: leaves, error: leaveErr } = await service
      .from('hr_leaves')
      .select('id, from_date, to_date, cert_path, leave_type:hr_leave_types(code, paid, paid_with_cert, deduct_sc, deduct_travel)')
      .eq('user_id', userId).eq('status', 'approved')
      .lte('from_date', periodEnd).gte('to_date', periodStart);
    if (leaveErr) throw leaveErr;
    // Every approved leave covers its dates — even the ones that don't dock SC (พักร้อน). A covered
    // day is never "unauthorised absence", so this set must be built from ALL of them, before the
    // deductSc filter below.
    const leaveCovered = new Set<string>();
    for (const lv of (leaves ?? []) as unknown as LeaveRow[]) {
      for (const d of enumerateDates(clampMax(lv.from_date, periodStart), clampMin(lv.to_date, periodEnd))) {
        leaveCovered.add(d);
      }
    }
    for (const lv of (leaves ?? []) as unknown as LeaveRow[]) {
      const lt = Array.isArray(lv.leave_type) ? lv.leave_type[0] : lv.leave_type;
      if (!lt) continue;
      const effect = classifyLeaveEffect(lt, Boolean(lv.cert_path));
      if (!effect.deductSc) continue;
      const from = clampMax(lv.from_date, periodStart);
      const to = clampMin(lv.to_date, periodEnd);
      const scDays = enumerateDates(from, to).filter((d) => !dayOffSet.has(d)).length;
      const { amount_satang } = computeLeaveScDeduction(allocated, scDays, policies.sc_leave_divisor);
      if (amount_satang > 0) {
        lines.push({ allocation_id: allocId, source_type: 'leave', source_ref: lv.id, label: `Leave: ${lt.code} (${scDays}d)`, amount_satang, carry_satang: 0, auto: true, created_by: actorId });
      }
    }

    // Unauthorised absence docks SC at the same ÷divisor rate as leave (client rule 2026-07-20:
    // ขาดงาน → หักเงินเดือน + เซอร์วิส + ค่าเดินทาง). Mirrors time-engine's `absent = scheduled &&
    // !firstIn`, with an HR override able to force or clear the flag either way, and any approved
    // leave (docking or not) clearing it. Without this a no-show kept their full SC share while
    // someone who filed ลากิจ lost it.
    const { data: punches, error: punchErr } = await service
      .from('hr_attendance').select('business_date')
      .eq('user_id', userId).eq('type', 'in')
      .gte('business_date', periodStart).lte('business_date', periodEnd);
    if (punchErr) throw punchErr;
    const punchedSet = new Set((punches ?? []).map((r) => r.business_date as string));

    const { data: tsOverrides, error: tsErr } = await service
      .from('hr_timesheet_overrides').select('business_date, absent')
      .eq('user_id', userId)
      .gte('business_date', periodStart).lte('business_date', periodEnd);
    if (tsErr) throw tsErr;
    const absentOverride = new Map<string, boolean>();
    for (const r of tsOverrides ?? []) {
      if (r.absent !== null) absentOverride.set(r.business_date as string, r.absent as boolean);
    }

    // Only days that have CLOSED can be an absence — a rostered day still ahead of us cannot have a
    // punch yet, and docking SC for it would take money for work nobody could have done (mirrors
    // the same guard in time-engine). An explicit HR override still wins either way.
    const closedThrough = businessDateBangkok();
    const absentDays = enumerateDates(periodStart, periodEnd).filter((d) => {
      if (leaveCovered.has(d)) return false;
      // The roster decides whether the day was owed at all, and it is checked FIRST. It used to be
      // checked last, so an override saying "absent" counted even on a rostered day off — which is
      // exactly what the bulk-backfill tool wrote when a range was stamped across a week, docking
      // Service Charge for days nobody was due to work.
      if (!rosteredSet.has(d)) return false;
      const forced = absentOverride.get(d);
      if (forced !== undefined) return forced;
      return !punchedSet.has(d) && d <= closedThrough;
    }).length;

    if (absentDays > 0) {
      const { amount_satang } = computeLeaveScDeduction(allocated, absentDays, policies.sc_leave_divisor);
      if (amount_satang > 0) {
        lines.push({ allocation_id: allocId, source_type: 'absent', source_ref: null, label: `Absent (${absentDays}d)`, amount_satang, carry_satang: 0, auto: true, created_by: actorId });
      }
    }

    // Swap only the auto lines this routine OWNS (never 'eval'/'stock_penalty' base lines or 'manual').
    const { error: delErr } = await service
      .from(DED).delete().eq('allocation_id', allocId).eq('auto', true)
      .in('source_type', ['warning', 'warning_carry', 'leave', 'absent', 'eval_carry', 'stock_penalty_carry']);
    if (delErr) throw delErr;
    if (lines.length > 0) {
      const { error: insErr } = await service.from(DED).insert(lines);
      if (insErr) throw insErr;
    }
  }

  // §H: split applied vs carried against each person's shared balance now that all lines exist.
  await reconcilePoolDeductions(service, poolId);
}

/**
 * Re-run the auto SC lines for one person after something that should dock their service charge —
 * a warning issued, or voided — so the deduction appears without HR going to find the Recompute
 * button.
 *
 * It used not to run at all: issuing a warning inserted the row and stopped there, and the dock only
 * materialised the next time somebody saved allocations, pressed Recompute, or finalized the pool.
 * HR issued two warnings on 2026-08-20 and neither reached the payslip (client report), which is
 * exactly what "ออกใบเตือนหัก SV มันไม่หักให้" describes.
 *
 * Every DRAFT pool for that month holding an allocation for this person is rebuilt — a person can
 * be allocated at more than one store, and a finalized pool is deliberately left alone.
 *
 * @param at ISO timestamp of the event; the BANGKOK payroll CYCLE it falls in decides the pool via
 *           scPoolMonthForDate, matching the window recomputePoolDeductions() reads warnings over.
 * @returns what happened, so the caller can tell HR when a dock could not be applied
 */
export async function recomputeScForUserAt(
  service: SupabaseClient,
  userId: string,
  at: string | null,
  actorId: string | null,
): Promise<'ok' | 'no_pool' | 'failed'> {
  try {
    // The pool an event docks is the one paid a month after the CYCLE it falls in — so a warning
    // issued on the 28th belongs to the cycle that began on the 26th and reaches the pool two
    // transfers away, not the one eighteen days later.
    const bkk = toBangkokISO(at ? new Date(at) : undefined);
    const periodMonth = scPoolMonthForDate(bkk.slice(0, 10));

    const { data: allocs, error: allocErr } = await service
      .from(ALLOC)
      .select('pool_id, pool:hr_sc_pools!inner(id, period_month, status)')
      .eq('user_id', userId)
      .eq('pool.period_month', periodMonth)
      .eq('pool.status', 'draft');
    if (allocErr) throw allocErr;

    const poolIds = [...new Set(((allocs ?? []) as unknown as { pool_id: string }[]).map((a) => a.pool_id))];
    if (poolIds.length === 0) return 'no_pool';

    for (const poolId of poolIds) await recomputePoolDeductions(service, poolId, actorId);
    return 'ok';
  } catch {
    // The warning itself is already saved; failing the whole request would be worse than reporting
    // that the dock needs a manual Recompute.
    return 'failed';
  }
}
