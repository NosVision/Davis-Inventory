import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { resolveEvalPayout, type EvalPayoutRule, type EvalTier } from '@/lib/hr/evaluation';

const PERIODS = 'hr_eval_periods';
const RESULTS = 'hr_eval_results';
const RULES = 'hr_eval_payout_rules';
const TIERS = 'hr_eval_payout_tiers';
const PAYOUTS = 'hr_eval_payouts';

// GET /api/hr/eval/periods/[id]/payouts — the computed payouts for a period (HR).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const service = createServiceClient();
  const { data, error } = await service
    .from(PAYOUTS)
    .select('*, result:hr_eval_results!inner(employee_id, score_pct, period_id)')
    .eq('result.period_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/hr/eval/periods/[id]/payouts — compute money for each employee from their result
// via the period's payout rule (§G). Runs the PURE resolveEvalPayout and FREEZES the rule as a
// formula_snapshot so later rule edits don't retroactively change a computed payout. Rebuilds
// draft payouts idempotently (deletes prior draft payouts for the period first); payouts already
// applied_to_payslip are left untouched (correction = supersede, handled elsewhere).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const service = createServiceClient();

  const { data: period, error: pErr } = await service.from(PERIODS).select('id, status').eq('id', id).maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 });

  const { data: rule, error: rErr } = await service.from(RULES).select('*').eq('period_id', id).maybeSingle();
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (!rule) return NextResponse.json({ error: 'No payout rule set for this period' }, { status: 409 });

  let engineRule: EvalPayoutRule;
  if (rule.formula_type === 'linear') {
    engineRule = { formula_type: 'linear', flat_satang: rule.flat_satang, satang_per_pct: rule.satang_per_pct };
  } else {
    const { data: tiers } = await service.from(TIERS).select('*').eq('rule_id', rule.id).order('sort_order');
    engineRule = {
      formula_type: 'tiered',
      tiers: ((tiers ?? []) as EvalTier[]).map((t) => ({
        id: t.id, min_pct: t.min_pct, max_pct: t.max_pct, amount_satang: t.amount_satang, label: t.label,
      })),
    };
  }

  const { data: results, error: resErr } = await service
    .from(RESULTS)
    .select('id, employee_id, score_pct, status')
    .eq('period_id', id);
  if (resErr) return NextResponse.json({ error: resErr.message }, { status: 500 });
  if (!results || results.length === 0) {
    return NextResponse.json({ error: 'No computed results; run compute first' }, { status: 409 });
  }

  const snapshot = freezeRule(engineRule);

  // Clear prior DRAFT payouts (idempotent rebuild); keep applied ones.
  const resultIds = results.map((r) => r.id);
  await service.from(PAYOUTS).delete().in('result_id', resultIds).eq('status', 'draft');

  const rows = results.map((r) => {
    const payout = resolveEvalPayout(engineRule, r.score_pct === null ? null : Number(r.score_pct));
    return {
      result_id: r.id,
      rule_id: rule.id,
      tier_matched_id: payout.tier_matched_id,
      input_pct_score: payout.input_pct_score,
      formula_snapshot: snapshot,
      amount_satang: payout.amount_satang,
      calculation_note: payout.note,
      status: 'draft',
      created_by: auth.userId,
    };
  });

  const { data: inserted, error: insErr } = await service.from(PAYOUTS).insert(rows).select('id');
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: PAYOUTS, recordId: id,
    before: null, after: { computed: (inserted ?? []).length }, reason: 'evaluation payouts computed',
  });
  return NextResponse.json({ data: { period_id: id, payouts: (inserted ?? []).length } });
}

// Freeze the engine rule as plain JSON for the payout snapshot (the rule is already plain data).
function freezeRule(rule: EvalPayoutRule): Record<string, unknown> {
  return JSON.parse(JSON.stringify(rule));
}
