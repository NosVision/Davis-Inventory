import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { aggregateEvalScores, type AssignmentRow, type ScoreRow } from '@/lib/hr/evaluation';

// GET /api/hr/ess/eval/my-results — the CALLER'S own evaluation results across periods, each
// with the §G anonymized per-evaluator breakdown ("ผู้ประเมิน A: 43 · B: 39" — no names).
// Auth-any, strictly self-scoped. Employees see results ONLY for closed periods (§G: visible
// after the period closes, before the 15th); a still-open period is hidden.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();

  // Own results whose period is closed.
  const { data: rows, error } = await service
    .from('hr_eval_results')
    .select('id, period_id, score_pct, evaluator_count, status, period:hr_eval_periods!inner(period_month, title, status, max_score)')
    .eq('employee_id', user.id)
    .eq('period.status', 'closed');
  if (error) return NextResponse.json({ error: 'Failed to load results' }, { status: 500 });

  const results = (rows ?? []) as unknown as {
    id: string; period_id: string; score_pct: number | null; evaluator_count: number; status: string;
    period: { period_month: string; title: string; status: string; max_score: number } | null;
  }[];
  if (results.length === 0) return NextResponse.json({ data: [] });

  // For each period, rebuild THIS employee's anonymized breakdown from the raw scores.
  const out = [];
  for (const r of results) {
    const { data: aRows } = await service
      .from('hr_eval_assignments')
      .select('id, evaluator_id, employee_id, status')
      .eq('period_id', r.period_id)
      .eq('employee_id', user.id);
    const assignments: AssignmentRow[] = (aRows ?? []).map((a) => ({
      assignment_id: a.id as string,
      evaluator_id: a.evaluator_id as string,
      employee_id: a.employee_id as string,
      submitted: a.status === 'submitted',
    }));
    let scores: ScoreRow[] = [];
    const assignmentIds = assignments.map((a) => a.assignment_id);
    if (assignmentIds.length) {
      const { data: sRows } = await service.from('hr_eval_scores').select('assignment_id, points').in('assignment_id', assignmentIds);
      scores = (sRows ?? []).map((s) => ({ assignment_id: s.assignment_id as string, points: Number(s.points) }));
    }
    const agg = aggregateEvalScores(assignments, scores, r.period?.max_score ?? 0);
    const mine = agg.find((a) => a.employee_id === user.id);

    out.push({
      period_month: r.period?.period_month ?? null,
      title: r.period?.title ?? '',
      score_pct: r.score_pct,
      evaluator_count: r.evaluator_count,
      // §G: show each evaluator's number, NEVER their name.
      breakdown: mine?.breakdown ?? [],
    });
  }
  out.sort((a, b) => String(b.period_month).localeCompare(String(a.period_month)));

  return NextResponse.json({ data: out });
}
