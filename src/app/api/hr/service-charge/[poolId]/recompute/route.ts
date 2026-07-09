import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { classifyLeaveEffect, enumerateDates } from '@/lib/hr/leaves';
import { getHrPolicies } from '@/lib/hr/policy';
import {
  computeWarningScDeduction,
  computeLeaveScDeduction,
  computeCarryScDeduction,
  computeNetSc,
} from '@/lib/hr/service-charge';

const POOL = 'hr_sc_pools';
const ALLOC = 'hr_sc_allocations';
const DED = 'hr_sc_deductions';

// The month AFTER a 'YYYY-MM-01' period, as 'YYYY-MM-01'.
function nextMonthFirst(periodMonth: string): string {
  const [y, m] = periodMonth.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}
// The month BEFORE a 'YYYY-MM-01' period, as 'YYYY-MM-01'.
function prevMonthFirst(periodMonth: string): string {
  const [y, m] = periodMonth.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}-01`;
}
// The day before a 'YYYY-MM-DD' date.
function prevDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function clampMax(a: string, b: string): string {
  return a > b ? a : b;
}
function clampMin(a: string, b: string): string {
  return a < b ? a : b;
}

interface WarningRow {
  id: string;
  level: string;
  sc_deduct_percent: number | null;
  amount_satang: number | null;
}
interface LeaveRow {
  id: string;
  from_date: string;
  to_date: string;
  cert_path: string | null;
  leave_type: { code: string; paid: boolean } | { code: string; paid: boolean }[] | null;
}

// POST /api/hr/service-charge/[poolId]/recompute — rebuild the AUTO (warning + leave) SC
// deduction lines for every allocation in a draft pool (§H). Manual lines (auto=false) are
// preserved. Money math lives in the pure @/lib/hr/service-charge helpers so it stays
// satang-exact and testable. A 200% warning deducts this month's SC in full and carries the
// second month (carry_satang) for visibility (auto cross-period application is a later step).
export async function POST(_request: Request, { params }: { params: Promise<{ poolId: string }> }) {
  const { poolId } = await params;
  const service = createServiceClient();
  const policies = await getHrPolicies(service);

  const { data: pool, error: poolErr } = await service
    .from(POOL)
    .select('id, store_id, period_month, status')
    .eq('id', poolId)
    .maybeSingle();
  if (poolErr) return NextResponse.json({ error: 'Failed to load pool' }, { status: 500 });
  if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });

  // §P5.5: gate on the pool's store.
  const auth = await requireStoreManager(pool.store_id as string);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if ((pool.status as string) === 'finalized') {
    return NextResponse.json({ error: 'Pool is finalized' }, { status: 409 });
  }

  const periodStart = pool.period_month as string; // 'YYYY-MM-01'
  const nextStart = nextMonthFirst(periodStart);
  const periodEnd = prevDay(nextStart); // inclusive last day of the month
  // hr_warnings.issued_at is TIMESTAMPTZ — compare against Bangkok-local month boundaries
  // (matching time-engine's +07:00 convention) so a warning issued in the small hours of
  // the 1st isn't mis-attributed to the previous month in UTC.
  const periodStartTs = `${periodStart}T00:00:00+07:00`;
  const nextStartTs = `${nextStart}T00:00:00+07:00`;

  // The PRIOR month's pool for this store — used to carry an unfinished multi-cycle warning
  // (e.g. the 2nd month of a 200% warning) into this period. Null when this is the first month.
  const prevStart = prevMonthFirst(periodStart);
  const { data: prevPool, error: prevPoolErr } = await service
    .from(POOL)
    .select('id')
    .eq('store_id', pool.store_id as string)
    .eq('period_month', prevStart)
    .maybeSingle();
  if (prevPoolErr) return NextResponse.json({ error: 'Failed to load prior pool' }, { status: 500 });

  const { data: allocs, error: allocErr } = await service
    .from(ALLOC)
    .select('id, user_id, allocated_satang')
    .eq('pool_id', poolId);
  if (allocErr) return NextResponse.json({ error: 'Failed to load allocations' }, { status: 500 });

  for (const alloc of allocs ?? []) {
    const allocId = alloc.id as string;
    const userId = alloc.user_id as string;
    const allocated = Number(alloc.allocated_satang) || 0;

    const lines: Record<string, unknown>[] = [];

    // Fetch the source rows FIRST (and check errors) so a failed query can NEVER lead to
    // deleting the existing auto lines without re-inserting — that would silently understate
    // the deduction and overstate net SC on the payslip.
    // --- Warnings issued within this period (active/acknowledged, not void). ---
    const { data: warnings, error: warnErr } = await service
      .from('hr_warnings')
      .select('id, level, sc_deduct_percent, amount_satang')
      .eq('user_id', userId)
      .in('status', ['active', 'acknowledged'])
      .gte('issued_at', periodStartTs)
      .lt('issued_at', nextStartTs);
    if (warnErr) {
      return NextResponse.json({ error: 'Failed to load warnings for recompute' }, { status: 500 });
    }
    for (const w of (warnings ?? []) as unknown as WarningRow[]) {
      const { amount_satang, carry_satang } = computeWarningScDeduction(allocated, {
        level: w.level,
        sc_deduct_percent: w.sc_deduct_percent,
        amount_satang: w.amount_satang,
      });
      if (amount_satang > 0 || carry_satang > 0) {
        lines.push({
          allocation_id: allocId,
          source_type: 'warning',
          source_ref: w.id,
          label: `Warning: ${w.level}`,
          amount_satang,
          carry_satang,
          auto: true,
          created_by: auth.userId,
        });
      }
    }

    // --- Carry from the PRIOR month's deductions that overflowed one month: the 2nd+ month of a
    //     200% warning / a large amount_baht penalty ('warning' family), and an evaluation SC
    //     penalty larger than a month's SC ('eval' family). Reads the prior pool's carry per family
    //     and lays down a matching '*_carry' line here, itself carrying any residual overflow. ---
    if (prevPool && policies.warning_carry_enabled) {
      const { data: prevAlloc, error: prevAllocErr } = await service
        .from(ALLOC)
        .select('id')
        .eq('pool_id', prevPool.id as string)
        .eq('user_id', userId)
        .maybeSingle();
      if (prevAllocErr) {
        return NextResponse.json({ error: 'Failed to load prior allocation' }, { status: 500 });
      }
      if (prevAlloc) {
        const CARRY_FAMILIES = [
          { sources: ['warning', 'warning_carry'], outType: 'warning_carry', label: 'Warning carry (prev month)' },
          { sources: ['eval', 'eval_carry'], outType: 'eval_carry', label: 'Evaluation carry (prev month)' },
          { sources: ['stock_penalty', 'stock_penalty_carry'], outType: 'stock_penalty_carry', label: 'Stock penalty carry (prev month)' },
        ];
        for (const fam of CARRY_FAMILIES) {
          const { data: prevCarryRows, error: prevCarryErr } = await service
            .from(DED)
            .select('carry_satang')
            .eq('allocation_id', prevAlloc.id as string)
            .in('source_type', fam.sources)
            .gt('carry_satang', 0);
          if (prevCarryErr) {
            return NextResponse.json({ error: 'Failed to load prior carry' }, { status: 500 });
          }
          const priorCarry = (prevCarryRows ?? []).reduce((s, d) => s + (Number(d.carry_satang) || 0), 0);
          const { amount_satang, carry_satang } = computeCarryScDeduction(allocated, priorCarry);
          if (amount_satang > 0 || carry_satang > 0) {
            lines.push({
              allocation_id: allocId,
              source_type: fam.outType,
              source_ref: prevPool.id,
              label: fam.label,
              amount_satang,
              carry_satang,
              auto: true,
              created_by: auth.userId,
            });
          }
        }
      }
    }

    // The employee's scheduled weekly day-offs in this period — a leave day that falls on a day off
    // does NOT dock SC (they weren't rostered to work it), matching the salary path in payruns.
    const { data: schedOff, error: schedOffErr } = await service
      .from('hr_schedule')
      .select('work_date')
      .eq('user_id', userId)
      .eq('store_id', pool.store_id as string)
      .eq('is_day_off', true)
      .gte('work_date', periodStart)
      .lte('work_date', periodEnd);
    if (schedOffErr) {
      return NextResponse.json({ error: 'Failed to load schedule day-offs' }, { status: 500 });
    }
    const dayOffSet = new Set((schedOff ?? []).map((r) => r.work_date as string));

    // --- Approved leaves overlapping this period that dock SC. ---
    const { data: leaves, error: leaveErr } = await service
      .from('hr_leaves')
      .select('id, from_date, to_date, cert_path, leave_type:hr_leave_types(code, paid)')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .lte('from_date', periodEnd)
      .gte('to_date', periodStart);
    if (leaveErr) {
      return NextResponse.json({ error: 'Failed to load leaves for recompute' }, { status: 500 });
    }
    for (const lv of (leaves ?? []) as unknown as LeaveRow[]) {
      const lt = Array.isArray(lv.leave_type) ? lv.leave_type[0] : lv.leave_type;
      if (!lt) continue;
      const effect = classifyLeaveEffect({ code: lt.code, paid: lt.paid }, Boolean(lv.cert_path));
      if (!effect.deductSc) continue;
      const from = clampMax(lv.from_date, periodStart);
      const to = clampMin(lv.to_date, periodEnd);
      const scDays = enumerateDates(from, to).filter((d) => !dayOffSet.has(d)).length;
      const { amount_satang } = computeLeaveScDeduction(allocated, scDays, policies.sc_leave_divisor);
      if (amount_satang > 0) {
        lines.push({
          allocation_id: allocId,
          source_type: 'leave',
          source_ref: lv.id,
          label: `Leave: ${lt.code} (${scDays}d)`,
          amount_satang,
          carry_satang: 0,
          auto: true,
          created_by: auth.userId,
        });
      }
    }

    // Only now (after every source query succeeded) swap the auto lines this route OWNS. Scope the
    // delete to the source types recompute produces (warning/warning_carry/leave/eval_carry) so it
    // never wipes lines owned by other routes — notably 'eval' (laid down by eval apply-sc) and
    // 'manual' (auto=false). Deleting all auto lines here previously erased applied eval SC penalties.
    await service
      .from(DED)
      .delete()
      .eq('allocation_id', allocId)
      .eq('auto', true)
      .in('source_type', ['warning', 'warning_carry', 'leave', 'eval_carry', 'stock_penalty_carry']);
    if (lines.length > 0) {
      await service.from(DED).insert(lines);
    }
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: POOL,
    recordId: poolId,
    reason: 'Recomputed auto SC deductions (warnings + leave)',
  });

  // Return the refreshed detail (allocations + deductions + net).
  const { data: freshAllocs } = await service
    .from(ALLOC)
    .select(
      'id, user_id, allocated_satang, employee:profiles!hr_sc_allocations_user_id_fkey(id, display_name, username)'
    )
    .eq('pool_id', poolId);

  const detail = [];
  let totAlloc = 0;
  let totDed = 0;
  let totNet = 0;
  for (const a of freshAllocs ?? []) {
    const { data: deds } = await service
      .from(DED)
      .select('id, source_type, source_ref, label, amount_satang, carry_satang, note, auto')
      .eq('allocation_id', a.id as string)
      .order('created_at', { ascending: true });
    const allocated = Number(a.allocated_satang) || 0;
    const net = computeNetSc(
      allocated,
      (deds ?? []).map((d) => ({ amount_satang: Number(d.amount_satang) || 0 }))
    );
    const deducted = allocated - net;
    totAlloc += allocated;
    totDed += deducted;
    totNet += net;
    detail.push({ ...a, deductions: deds ?? [], net_satang: net });
  }

  return NextResponse.json({
    data: {
      pool,
      allocations: detail,
      totals: { allocated: totAlloc, deducted: totDed, net: totNet },
    },
  });
}
