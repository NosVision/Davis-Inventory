import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { computeStockPenaltyScDeduction } from '@/lib/hr/service-charge';
import { cycleDates, scPoolMonthForEvent } from '@/lib/hr/pay-cycle';

const SC_POOLS = 'hr_sc_pools';
const SC_ALLOCS = 'hr_sc_allocations';
const SC_DEDUCTIONS = 'hr_sc_deductions';

// POST /api/hr/service-charge/apply-stock-penalties  { store_id, period_month }
// Sync a store's accumulated stock fines for one PAYROLL CYCLE into Service Charge deductions
// (owner ask 2026-07-09; see docs/hr/stock-penalty-to-hr.md). Mirrors the eval apply-sc pattern:
// for each person, sum their non-cancelled stock-penalty amounts (baht) dated inside that cycle,
// dock from their SC allocation via clamp+carry, and lay down one auto 'stock_penalty' line. Carry
// to next month is produced by the SC recompute route (stock_penalty family). Idempotent: prior
// auto stock_penalty lines are cleared first. HR / store-scoped manager only; pool must be draft.
//
// `period_month` names the CYCLE the fines belong to ('YYYY-MM' = 26th of the month before through
// the 25th), and the pool docked is the one paid a month later — the same rule leave, absence,
// warnings and evaluations follow since 2026-08-24. It used to select on the fines' month_year tag
// and dock the pool of that SAME month, which had already been transferred on the 15th: the fine
// either came out of paid money, or hit "กอง SC เดือนนี้ปิดรอบแล้ว" and could never be applied.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const rawMonth = typeof body.period_month === 'string' ? body.period_month : '';
  if (!storeId || !rawMonth) {
    return NextResponse.json({ error: 'store_id, period_month required' }, { status: 400 });
  }
  const cycleMonth = rawMonth.slice(0, 7); // 'YYYY-MM' — the payroll cycle the fines fall in
  const [cy, cm] = cycleMonth.split('-').map(Number);
  const cycle = cycleDates(cy, cm); // 26th of cy-cm−1 → 25th of cy-cm
  const periodMonth = scPoolMonthForEvent(cycleMonth); // the pool paid a month after that cycle

  const auth = await requireStoreManager(storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();

  const { data: pool } = await service
    .from(SC_POOLS)
    .select('id, status')
    .eq('store_id', storeId)
    .eq('period_month', periodMonth)
    .maybeSingle();
  if (!pool) {
    return NextResponse.json({ error: 'ยังไม่มีกอง Service Charge ของเดือนนี้ — สร้าง/จัดสรร SC ก่อน' }, { status: 409 });
  }
  if ((pool as { status: string }).status === 'finalized') {
    return NextResponse.json({ error: 'กอง SC เดือนนี้ปิดรอบแล้ว แก้ไขไม่ได้' }, { status: 409 });
  }
  const poolId = (pool as { id: string }).id;

  const { data: allocs } = await service
    .from(SC_ALLOCS)
    .select('id, user_id, allocated_satang')
    .eq('pool_id', poolId);
  const allocList = (allocs ?? []) as { id: string; user_id: string; allocated_satang: number }[];
  const allocByUser = new Map(allocList.map((a) => [a.user_id, a]));

  // Sum this cycle's stock fines per person (baht → satang), by the day each fine happened.
  const { data: pen } = await service
    .from('penalties')
    .select('staff_id, amount')
    .eq('store_id', storeId)
    .gte('business_date', cycle.start)
    .lte('business_date', cycle.end)
    .neq('status', 'cancelled');
  const totalByUser = new Map<string, number>();
  for (const p of (pen ?? []) as { staff_id: string; amount: number | null }[]) {
    const satang = Math.round((Number(p.amount) || 0) * 100);
    if (satang > 0) totalByUser.set(p.staff_id, (totalByUser.get(p.staff_id) ?? 0) + satang);
  }

  // Idempotent: clear prior AUTO stock_penalty lines on these allocations before re-applying.
  const allocIds = allocList.map((a) => a.id);
  if (allocIds.length) {
    await service.from(SC_DEDUCTIONS).delete().in('allocation_id', allocIds).eq('source_type', 'stock_penalty');
  }

  let applied = 0;
  let skippedNoAlloc = 0;
  let totalCarrySatang = 0;
  for (const [userId, satang] of totalByUser) {
    const alloc = allocByUser.get(userId);
    if (!alloc) {
      skippedNoAlloc++;
      continue;
    }
    const ded = computeStockPenaltyScDeduction(alloc.allocated_satang, satang);
    if (ded.amount_satang <= 0 && ded.carry_satang <= 0) continue;
    const { error: insErr } = await service.from(SC_DEDUCTIONS).insert({
      allocation_id: alloc.id,
      source_type: 'stock_penalty',
      source_ref: null,
      label: 'ค่าปรับสต๊อก',
      amount_satang: ded.amount_satang,
      carry_satang: ded.carry_satang,
      auto: true,
      created_by: auth.userId,
    });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    applied++;
    totalCarrySatang += ded.carry_satang;
  }

  // Mark this cycle's money fines as deducted (workflow status → moves them to HQ's history; the
  // SV line above is the authoritative money, this is just the lifecycle flag). Selected on the
  // same dates the sum used — closing a different set than the one just charged would strand
  // fines as 'sent_hr' forever, or retire fines nobody deducted.
  await service
    .from('penalties')
    .update({ status: 'deducted' })
    .eq('store_id', storeId)
    .gte('business_date', cycle.start)
    .lte('business_date', cycle.end)
    .in('status', ['pending', 'sent_hr'])
    .gt('amount', 0);

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: SC_DEDUCTIONS,
    recordId: poolId,
    before: null,
    after: { store_id: storeId, cycle: cycleMonth, cycle_start: cycle.start, cycle_end: cycle.end, applied, skipped_no_alloc: skippedNoAlloc },
    reason: 'stock penalties applied as SC deductions',
  });

  return NextResponse.json({
    data: { applied, skipped_no_alloc: skippedNoAlloc, carry_satang: totalCarrySatang },
  });
}
