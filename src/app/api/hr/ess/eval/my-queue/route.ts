import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { buildEmployeeNameMap } from '@/lib/hr/employee-name-map';

// GET /api/hr/ess/eval/my-queue?period_id= — the CALLER'S own evaluation assignments for a
// period (§G evaluator UX: 1 person may evaluate ~50 people → a queue with the not-yet-scored
// on top). Auth-any, strictly the caller's own assignments (evaluator_id = self). Returns each
// assignee's name + whether the caller has finished scoring them, so the UI can show
// total/done/pending and auto-advance to the next pending person.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const periodId = request.nextUrl.searchParams.get('period_id');
  if (!periodId) return NextResponse.json({ error: 'period_id is required' }, { status: 400 });

  const service = createServiceClient();

  // The period's criteria (id/name/max_points) — both the "fully scored" count AND the scoring
  // form's field list, so the evaluator UI needs no extra HR-only criteria call.
  const { data: crit } = await service
    .from('hr_eval_criteria')
    .select('id, name, max_points, sort_order')
    .eq('period_id', periodId)
    .order('sort_order');
  const criteria = (crit ?? []) as { id: string; name: string; max_points: number; sort_order: number }[];
  const criteriaCount = criteria.length;

  const { data: aRows, error } = await service
    .from('hr_eval_assignments')
    .select('id, employee_id, status')
    .eq('period_id', periodId)
    .eq('evaluator_id', user.id); // self only
  if (error) return NextResponse.json({ error: 'Failed to load queue' }, { status: 500 });

  const assignments = (aRows ?? []) as { id: string; employee_id: string; status: string }[];
  if (assignments.length === 0) return NextResponse.json({ data: { total: 0, done: 0, pending: 0, criteria, items: [] } });

  const employeeIds = [...new Set(assignments.map((a) => a.employee_id))];
  const assignmentIds = assignments.map((a) => a.id);
  const [nameEntries, { data: scoreRows }] = await Promise.all([
    // ชื่อจริง (ชื่อเล่น): an evaluator picking a colleague out of a 50-person queue needs the
    // formal name to be sure who it is, and the nickname to recognise them.
    buildEmployeeNameMap(service, employeeIds),
    service.from('hr_eval_scores').select('assignment_id').in('assignment_id', assignmentIds),
  ]);
  const nameById = new Map(
    [...nameEntries].map(([id, n]) => [id, n.nickname ? `${n.name} (${n.nickname})` : n.name])
  );
  const scoreCountByAssignment = new Map<string, number>();
  for (const s of scoreRows ?? []) {
    const k = s.assignment_id as string;
    scoreCountByAssignment.set(k, (scoreCountByAssignment.get(k) ?? 0) + 1);
  }

  const items = assignments.map((a) => {
    const scored = scoreCountByAssignment.get(a.id) ?? 0;
    const complete = a.status === 'submitted' || (criteriaCount > 0 && scored >= criteriaCount);
    return {
      assignment_id: a.id,
      employee_id: a.employee_id,
      employee_name: nameById.get(a.employee_id) ?? '—',
      status: a.status,
      scored_criteria: scored,
      criteria_count: criteriaCount,
      complete,
    };
  });
  // queue: pending (incomplete) first, then by name
  items.sort((x, y) => (x.complete === y.complete ? x.employee_name.localeCompare(y.employee_name) : x.complete ? 1 : -1));

  const done = items.filter((i) => i.complete).length;
  return NextResponse.json({ data: { total: items.length, done, pending: items.length - done, criteria, items } });
}
