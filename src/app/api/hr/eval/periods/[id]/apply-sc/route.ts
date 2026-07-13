import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { computeEvalScDeduction } from '@/lib/hr/service-charge';

const PERIODS = 'hr_eval_periods';
const RESULTS = 'hr_eval_results';
const PAYOUTS = 'hr_eval_payouts';
const SC_POOLS = 'hr_sc_pools';
const SC_ALLOCS = 'hr_sc_allocations';
const SC_DEDUCTIONS = 'hr_sc_deductions';

// POST /api/hr/eval/periods/[id]/apply-sc — apply the period's NEGATIVE eval payouts as SC
// deductions (§G↔§H: "ผลประเมินเป็นตัวหักจาก SC"). HR only. For each draft/approved payout with
// amount < 0, we find the employee's SC allocation for the SAME month and store side (matched by
// hr_sc_pools.period_month = the eval period's month) and insert an hr_sc_deductions row via the
// PURE computeEvalScDeduction (clamp+carry vs the allocation). Positive payouts are bonuses paid
// through the payslip (type='eval_bonus') at payrun time — NOT here. Idempotent: prior auto eval
// deductions for these allocations are cleared first. The SC pool must not be finalized.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const service = createServiceClient();

  const { data: period, error: pErr } = await service
    .from(PERIODS)
    .select('id, period_month, status')
    .eq('id', id)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 });

  // APPROVED negative payouts (deductions) only — symmetric with the positive side (payrun applies
  // only status='approved' eval bonuses). Applying draft/void/superseded negatives would dock SC on
  // unconfirmed or reverted results; combined with the clear-then-reapply below, a payout later
  // voided is cleared and never re-applied.
  const { data: payouts, error: poErr } = await service
    .from(PAYOUTS)
    .select('id, amount_satang, status, result:hr_eval_results!inner(employee_id, period_id)')
    .eq('result.period_id', id)
    .eq('status', 'approved')
    .lt('amount_satang', 0);
  if (poErr) return NextResponse.json({ error: poErr.message }, { status: 500 });
  const negatives = (payouts ?? []) as unknown as {
    id: string; amount_satang: number; status: string; result: { employee_id: string } | null;
  }[];
  if (negatives.length === 0) {
    return NextResponse.json({ data: { period_id: id, applied: 0, note: 'no negative payouts to apply' } });
  }

  // SC pools for this month (there may be several stores); index allocations by user.
  const { data: pools, error: poolErr } = await service
    .from(SC_POOLS)
    .select('id, status')
    .eq('period_month', period.period_month);
  if (poolErr) return NextResponse.json({ error: poolErr.message }, { status: 500 });
  const poolById = new Map((pools ?? []).map((p) => [p.id as string, p.status as string]));
  if (poolById.size === 0) {
    return NextResponse.json({ error: 'No Service Charge pool for this month; create/allocate SC first' }, { status: 409 });
  }

  const { data: allocs, error: aErr } = await service
    .from(SC_ALLOCS)
    .select('id, pool_id, user_id, allocated_satang')
    .in('pool_id', [...poolById.keys()]);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  const allocByUser = new Map((allocs ?? []).map((a) => [a.user_id as string, a]));

  // Idempotent: clear prior AUTO eval deductions on these allocations before re-applying.
  const allocIds = (allocs ?? []).map((a) => a.id as string);
  if (allocIds.length) {
    await service.from(SC_DEDUCTIONS).delete().in('allocation_id', allocIds).eq('source_type', 'eval');
  }

  let applied = 0;
  let skippedFinalized = 0;
  let skippedNoAlloc = 0;
  for (const p of negatives) {
    const employeeId = p.result?.employee_id;
    const alloc = employeeId ? allocByUser.get(employeeId) : undefined;
    if (!alloc) { skippedNoAlloc++; continue; }
    if (poolById.get(alloc.pool_id as string) === 'finalized') { skippedFinalized++; continue; }

    const ded = computeEvalScDeduction(alloc.allocated_satang as number, p.amount_satang);
    if (ded.amount_satang <= 0 && ded.carry_satang <= 0) continue;

    const { error: insErr } = await service.from(SC_DEDUCTIONS).insert({
      allocation_id: alloc.id,
      source_type: 'eval',
      source_ref: p.id,
      label: 'ผลประเมิน',
      amount_satang: ded.amount_satang,
      carry_satang: ded.carry_satang,
      auto: true,
      created_by: auth.userId,
    });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    applied++;
  }

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: SC_DEDUCTIONS, recordId: id,
    before: null, after: { applied, skipped_finalized: skippedFinalized, skipped_no_alloc: skippedNoAlloc },
    reason: 'evaluation payouts applied as SC deductions',
  });

  return NextResponse.json({
    data: { period_id: id, applied, skipped_finalized: skippedFinalized, skipped_no_alloc: skippedNoAlloc },
  });
}
