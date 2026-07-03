import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { classifyLeaveEffect, enumerateDates } from '@/lib/hr/leaves';
import {
  computeWarningScDeduction,
  computeLeaveScDeduction,
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
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { poolId } = await params;
  const service = createServiceClient();

  const { data: pool, error: poolErr } = await service
    .from(POOL)
    .select('id, store_id, period_month, status')
    .eq('id', poolId)
    .maybeSingle();
  if (poolErr) return NextResponse.json({ error: 'Failed to load pool' }, { status: 500 });
  if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });
  if ((pool.status as string) === 'finalized') {
    return NextResponse.json({ error: 'Pool is finalized' }, { status: 409 });
  }

  const periodStart = pool.period_month as string; // 'YYYY-MM-01'
  const nextStart = nextMonthFirst(periodStart);
  const periodEnd = prevDay(nextStart); // inclusive last day of the month

  const { data: allocs, error: allocErr } = await service
    .from(ALLOC)
    .select('id, user_id, allocated_satang')
    .eq('pool_id', poolId);
  if (allocErr) return NextResponse.json({ error: 'Failed to load allocations' }, { status: 500 });

  for (const alloc of allocs ?? []) {
    const allocId = alloc.id as string;
    const userId = alloc.user_id as string;
    const allocated = Number(alloc.allocated_satang) || 0;

    // Clear only the auto-computed lines; manual lines stay.
    await service.from(DED).delete().eq('allocation_id', allocId).eq('auto', true);

    const lines: Record<string, unknown>[] = [];

    // --- Warnings issued within this period (active/acknowledged, not void). ---
    const { data: warnings } = await service
      .from('hr_warnings')
      .select('id, level, sc_deduct_percent, amount_satang')
      .eq('user_id', userId)
      .in('status', ['active', 'acknowledged'])
      .gte('issued_at', periodStart)
      .lt('issued_at', nextStart);
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

    // --- Approved leaves overlapping this period that dock SC. ---
    const { data: leaves } = await service
      .from('hr_leaves')
      .select('id, from_date, to_date, cert_path, leave_type:hr_leave_types(code, paid)')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .lte('from_date', periodEnd)
      .gte('to_date', periodStart);
    for (const lv of (leaves ?? []) as unknown as LeaveRow[]) {
      const lt = Array.isArray(lv.leave_type) ? lv.leave_type[0] : lv.leave_type;
      if (!lt) continue;
      const effect = classifyLeaveEffect({ code: lt.code, paid: lt.paid }, Boolean(lv.cert_path));
      if (!effect.deductSc) continue;
      const from = clampMax(lv.from_date, periodStart);
      const to = clampMin(lv.to_date, periodEnd);
      const scDays = enumerateDates(from, to).length;
      const { amount_satang } = computeLeaveScDeduction(allocated, scDays);
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
