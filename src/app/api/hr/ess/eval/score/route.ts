import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const ASSIGNMENTS = 'hr_eval_assignments';
const CRITERIA = 'hr_eval_criteria';
const SCORES = 'hr_eval_scores';

// Evaluator-facing scoring (§G): an evaluator saves/updates points for ONE of their own
// assignments, then submits. Auth-any (createClient) + the assignment must belong to the caller.
// Points are clamped to the criterion's max_points server-side (UI clamps too, but never trust
// the client). Editable before submit; after submit an HR reopen is required (not handled here).

// GET /api/hr/ess/eval/score?assignment_id= — the caller's already-saved scores for ONE of their
// own assignments, so the scoring form prefills draft values on re-open. Self-scoped.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const assignmentId = request.nextUrl.searchParams.get('assignment_id');
  if (!assignmentId) return NextResponse.json({ error: 'assignment_id is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: assignment } = await service
    .from(ASSIGNMENTS)
    .select('id, evaluator_id, status')
    .eq('id', assignmentId)
    .maybeSingle();
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  if (assignment.evaluator_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: scoreRows, error } = await service
    .from(SCORES)
    .select('criterion_id, points, comment')
    .eq('assignment_id', assignmentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: { status: assignment.status, scores: scoreRows ?? [] } });
}

// POST /api/hr/ess/eval/score — body { assignment_id, scores:[{criterion_id,points,comment}], submit? }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const assignmentId = typeof body.assignment_id === 'string' ? body.assignment_id : '';
  const submit = body.submit === true;
  const rawScores = Array.isArray(body.scores) ? body.scores : [];
  if (!assignmentId) return NextResponse.json({ error: 'assignment_id is required' }, { status: 400 });

  const service = createServiceClient();

  // The assignment must belong to the caller and not already be submitted/withdrawn.
  const { data: assignment, error: aErr } = await service
    .from(ASSIGNMENTS)
    .select('id, period_id, evaluator_id, status')
    .eq('id', assignmentId)
    .maybeSingle();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  if (assignment.evaluator_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (assignment.status === 'submitted') {
    return NextResponse.json({ error: 'already submitted; ask HR to reopen to edit' }, { status: 409 });
  }

  // Valid criteria + their max points for this period (clamp source of truth).
  const { data: criteria, error: cErr } = await service
    .from(CRITERIA)
    .select('id, max_points')
    .eq('period_id', assignment.period_id);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  const maxByCriterion = new Map((criteria ?? []).map((c) => [c.id as string, Number(c.max_points)]));

  const rows: { assignment_id: string; criterion_id: string; points: number; comment: string | null }[] = [];
  for (const raw of rawScores) {
    const s = raw as Record<string, unknown>;
    const criterionId = typeof s.criterion_id === 'string' ? s.criterion_id : '';
    const max = maxByCriterion.get(criterionId);
    if (!criterionId || max === undefined) {
      return NextResponse.json({ error: `invalid criterion_id: ${criterionId}` }, { status: 400 });
    }
    const pts = Number(s.points);
    if (!Number.isFinite(pts) || pts < 0) {
      return NextResponse.json({ error: 'points must be a non-negative number' }, { status: 400 });
    }
    rows.push({
      assignment_id: assignmentId,
      criterion_id: criterionId,
      points: Math.min(pts, max), // clamp ≤ criterion max (§G: กันเคส 9.0/1)
      comment: typeof s.comment === 'string' ? s.comment.slice(0, 500) : null,
    });
  }

  if (rows.length) {
    const { error } = await service.from(SCORES).upsert(rows, { onConflict: 'assignment_id,criterion_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (submit) {
    // On submit, every criterion must have a score (no partial submits).
    const { count } = await service
      .from(SCORES)
      .select('id', { count: 'exact', head: true })
      .eq('assignment_id', assignmentId);
    if ((count ?? 0) < maxByCriterion.size) {
      return NextResponse.json({ error: 'all criteria must be scored before submitting' }, { status: 400 });
    }
    const { error: upErr } = await service
      .from(ASSIGNMENTS)
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', assignmentId)
      .eq('evaluator_id', user.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ data: { assignment_id: assignmentId, saved: rows.length, submitted: submit } });
}
