import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const ASSIGNMENTS = 'hr_eval_assignments';
const RESULTS = 'hr_eval_results';

// POST /api/hr/eval/periods/[id]/reopen-assignment — HR reopens a submitted assignment so the
// evaluator can edit their scores (§G: after submit, editing needs an HR reopen with a reason +
// audit). Flips status submitted→assigned. Any already-computed result for that employee is
// marked 'stale' so the payout can't be trusted until results are recomputed.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const assignmentId = typeof body.assignment_id === 'string' ? body.assignment_id : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!assignmentId) return NextResponse.json({ error: 'assignment_id is required' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: 'a reason is required to reopen' }, { status: 400 });

  const service = createServiceClient();
  const { data: before, error: fErr } = await service
    .from(ASSIGNMENTS)
    .select('id, evaluator_id, employee_id, status')
    .eq('id', assignmentId)
    .eq('period_id', id)
    .maybeSingle();
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  if (before.status !== 'submitted') {
    return NextResponse.json({ error: 'only a submitted assignment can be reopened' }, { status: 409 });
  }

  // compare-and-set on submitted → assigned so a concurrent reopen can't double-run
  const { data: updated, error } = await service
    .from(ASSIGNMENTS)
    .update({ status: 'assigned', submitted_at: null })
    .eq('id', assignmentId)
    .eq('status', 'submitted')
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: 'assignment was not in submitted state' }, { status: 409 });

  // Mark the employee's computed result stale (its inputs just changed).
  await service
    .from(RESULTS)
    .update({ status: 'stale' })
    .eq('period_id', id)
    .eq('employee_id', before.employee_id)
    .eq('status', 'computed');

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: ASSIGNMENTS, recordId: assignmentId,
    before, after: { status: 'assigned' }, reason: `assignment reopened: ${reason}`,
  });
  return NextResponse.json({ data: { assignment_id: assignmentId, status: 'assigned' } });
}
