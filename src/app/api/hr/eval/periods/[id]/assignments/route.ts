import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isUniqueViolation } from '@/lib/hr/db-errors';
import { notifyUser } from '@/lib/notifications/service';

const ASSIGNMENTS = 'hr_eval_assignments';
const SELECT =
  '*, evaluator:profiles!hr_eval_assignments_evaluator_id_fkey(id, display_name, username), ' +
  'employee:profiles!hr_eval_assignments_employee_id_fkey(id, display_name, username)';

// Who evaluates whom. Multi-evaluator = several rows for one employee with different evaluators
// (§G). HR-managed. evaluator ≠ employee (DB CHECK); (period,evaluator,employee) unique.

// GET /api/hr/eval/periods/[id]/assignments — all assignments for a period (HR view).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const service = createServiceClient();
  const { data, error } = await service.from(ASSIGNMENTS).select(SELECT).eq('period_id', id).order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/hr/eval/periods/[id]/assignments — assign one evaluator→employee. store_id optional
// snapshot. 400 if evaluator == employee; 409 on duplicate pair.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const evaluatorId = typeof body.evaluator_id === 'string' ? body.evaluator_id : '';
  const employeeId = typeof body.employee_id === 'string' ? body.employee_id : '';
  const storeId = typeof body.store_id === 'string' && body.store_id ? body.store_id : null;
  if (!evaluatorId || !employeeId) {
    return NextResponse.json({ error: 'evaluator_id and employee_id are required' }, { status: 400 });
  }
  if (evaluatorId === employeeId) {
    return NextResponse.json({ error: 'an evaluator cannot evaluate themselves' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from(ASSIGNMENTS)
    .insert({ period_id: id, evaluator_id: evaluatorId, employee_id: employeeId, store_id: storeId })
    .select(SELECT)
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'this evaluator is already assigned to this employee' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const created = data as unknown as {
    id: string;
    employee?: { display_name: string | null; username: string | null } | null;
  };
  await logHrAudit(service, {
    actorId: auth.userId, action: 'create', table: ASSIGNMENTS, recordId: created.id,
    before: null, after: data, reason: 'evaluation assignment created',
  });

  // Tell the evaluator they have a new person to evaluate (§Phase 4). Best-effort — a notification
  // failure must never fail the assignment. Do not notify the actor if they assigned themselves.
  if (evaluatorId !== auth.userId) {
    const employeeName = created.employee?.display_name || created.employee?.username || 'พนักงาน';
    try {
      await notifyUser({
        userId: evaluatorId,
        storeId,
        type: 'hr_eval_assigned',
        title: 'ได้รับมอบหมายประเมินผล',
        body: `คุณได้รับมอบหมายให้ประเมิน ${employeeName}`,
        titleKey: 'notificationTemplates.evalAssigned.title',
        bodyKey: 'notificationTemplates.evalAssigned.bodyOne',
        params: { name: employeeName },
        data: { period_id: id, url: '/me/evaluations' },
      });
    } catch (e) {
      console.error('[eval/assignments] notify evaluator failed:', e);
    }
  }

  return NextResponse.json({ data }, { status: 201 });
}

// DELETE /api/hr/eval/periods/[id]/assignments?assignment_id= — remove an assignment (HR).
// Cascades its scores. (Withdraw-after-submit is a status change, not delete; handled elsewhere.)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const assignmentId = request.nextUrl.searchParams.get('assignment_id') ?? '';
  if (!assignmentId) return NextResponse.json({ error: 'assignment_id is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: before } = await service.from(ASSIGNMENTS).select('*').eq('id', assignmentId).eq('period_id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });

  const { error } = await service.from(ASSIGNMENTS).delete().eq('id', assignmentId).eq('period_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'delete', table: ASSIGNMENTS, recordId: assignmentId,
    before, after: null, reason: 'evaluation assignment removed',
  });
  return NextResponse.json({ data: { id: assignmentId, removed: true } });
}
