import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyLeaveEffect, enumerateDates } from '@/lib/hr/leaves';
import { getHrPolicies } from '@/lib/hr/policy';
import {
  computeWarningScDeduction,
  computeLeaveScDeduction,
  computeCarryScDeduction,
} from '@/lib/hr/service-charge';
import { reconcilePoolDeductions } from '@/lib/hr/sc-reconcile';

const POOL = 'hr_sc_pools';
const ALLOC = 'hr_sc_allocations';
const DED = 'hr_sc_deductions';

function nextMonthFirst(periodMonth: string): string {
  const [y, m] = periodMonth.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}
function prevMonthFirst(periodMonth: string): string {
  const [y, m] = periodMonth.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}-01`;
}
function prevDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
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
  const periodStart = pool.period_month as string; // 'YYYY-MM-01'
  const nextStart = nextMonthFirst(periodStart);
  const periodEnd = prevDay(nextStart);
  const periodStartTs = `${periodStart}T00:00:00+07:00`;
  const nextStartTs = `${nextStart}T00:00:00+07:00`;

  const prevStart = prevMonthFirst(periodStart);
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

    const absentDays = enumerateDates(periodStart, periodEnd).filter((d) => {
      if (leaveCovered.has(d)) return false;
      const forced = absentOverride.get(d);
      if (forced !== undefined) return forced;
      return rosteredSet.has(d) && !punchedSet.has(d);
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
