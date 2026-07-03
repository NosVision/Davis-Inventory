import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { aggregateEvalScores, type AssignmentRow, type ScoreRow } from '@/lib/hr/evaluation';

const PERIODS = 'hr_eval_periods';
const ASSIGNMENTS = 'hr_eval_assignments';
const SCORES = 'hr_eval_scores';
const RESULTS = 'hr_eval_results';

// POST /api/hr/eval/periods/[id]/compute — average the submitted scores into per-employee
// results (§G: computed once at close, not live). HR only. Loads the period's assignments +
// scores, runs the PURE aggregateEvalScores, and upserts hr_eval_results. The period should be
// closed (or closing); we compute regardless of a couple of unsubmitted evaluators (they're
// excluded from the divisor, not counted as 0).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();

  const { data: period, error: pErr } = await service
    .from(PERIODS)
    .select('id, max_score, status')
    .eq('id', id)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 });
  if (period.status === 'void') {
    return NextResponse.json({ error: 'Cannot compute a void period' }, { status: 409 });
  }

  const { data: aRows, error: aErr } = await service
    .from(ASSIGNMENTS)
    .select('id, evaluator_id, employee_id, status')
    .eq('period_id', id);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  const assignments: AssignmentRow[] = (aRows ?? []).map((a) => ({
    assignment_id: a.id as string,
    evaluator_id: a.evaluator_id as string,
    employee_id: a.employee_id as string,
    submitted: a.status === 'submitted',
  }));

  const assignmentIds = assignments.map((a) => a.assignment_id);
  let scores: ScoreRow[] = [];
  if (assignmentIds.length) {
    const { data: sRows, error: sErr } = await service
      .from(SCORES)
      .select('assignment_id, points')
      .in('assignment_id', assignmentIds);
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
    scores = (sRows ?? []).map((s) => ({ assignment_id: s.assignment_id as string, points: Number(s.points) }));
  }

  const aggregates = aggregateEvalScores(assignments, scores, period.max_score as number);

  // Upsert one result row per employee (unique on period_id, employee_id).
  const now = new Date().toISOString();
  const rows = aggregates.map((agg) => ({
    period_id: id,
    employee_id: agg.employee_id,
    evaluator_count: agg.result.evaluator_count,
    raw_score_avg: agg.result.raw_score_avg,
    max_score: agg.result.max_score,
    score_pct: agg.result.score_pct,
    status: 'computed',
    computed_at: now,
  }));

  let upserted = 0;
  if (rows.length) {
    const { data, error } = await service
      .from(RESULTS)
      .upsert(rows, { onConflict: 'period_id,employee_id' })
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    upserted = (data ?? []).length;
  }

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: RESULTS, recordId: id,
    before: null, after: { computed: upserted, employees: aggregates.length },
    reason: 'evaluation results computed',
  });

  return NextResponse.json({ data: { period_id: id, results: upserted } });
}
