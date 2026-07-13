import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyUser } from '@/lib/notifications/service';

const ASSIGNMENTS = 'hr_eval_assignments';
// Guard rails so a mis-click can't fan out an unbounded number of inserts/notifications.
const MAX_PER_SIDE = 200;
const MAX_PAIRS = 4000;

// POST /api/hr/eval/periods/[id]/assignments/batch — assign a GROUP of evaluators to a GROUP of
// evaluatees in one action (§Phase 4 per-branch flow). Creates the cartesian product
// (evaluator × employee), skipping self-pairs and pairs that already exist, and stamps the chosen
// store on each row. Each evaluator is notified ONCE (not once per evaluatee). HR-only.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' && body.store_id ? body.store_id : null;
  const evaluatorIds = Array.isArray(body.evaluator_ids)
    ? [...new Set(body.evaluator_ids.filter((x): x is string => typeof x === 'string' && x.length > 0))]
    : [];
  const employeeIds = Array.isArray(body.employee_ids)
    ? [...new Set(body.employee_ids.filter((x): x is string => typeof x === 'string' && x.length > 0))]
    : [];

  if (evaluatorIds.length === 0 || employeeIds.length === 0) {
    return NextResponse.json({ error: 'Pick at least one evaluator and one evaluatee' }, { status: 400 });
  }
  if (evaluatorIds.length > MAX_PER_SIDE || employeeIds.length > MAX_PER_SIDE) {
    return NextResponse.json({ error: `At most ${MAX_PER_SIDE} on each side` }, { status: 400 });
  }

  // Cartesian product minus self-pairs (an evaluator never evaluates themselves — DB CHECK too).
  const rows: { period_id: string; evaluator_id: string; employee_id: string; store_id: string | null }[] = [];
  for (const evaluatorId of evaluatorIds) {
    for (const employeeId of employeeIds) {
      if (evaluatorId === employeeId) continue;
      rows.push({ period_id: id, evaluator_id: evaluatorId, employee_id: employeeId, store_id: storeId });
    }
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No valid pairs (evaluator and evaluatee are the same)' }, { status: 400 });
  }
  if (rows.length > MAX_PAIRS) {
    return NextResponse.json({ error: `Too many pairs (${rows.length}); narrow the selection` }, { status: 400 });
  }

  const service = createServiceClient();

  // ON CONFLICT DO NOTHING on the (period, evaluator, employee) unique key — existing pairs are
  // silently skipped, and .select() returns ONLY the freshly-inserted rows.
  const { data: inserted, error } = await service
    .from(ASSIGNMENTS)
    .upsert(rows, { onConflict: 'period_id,evaluator_id,employee_id', ignoreDuplicates: true })
    .select('id, evaluator_id, employee_id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const created = inserted ?? [];
  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: ASSIGNMENTS,
    recordId: id,
    before: null,
    after: { store_id: storeId, requested_pairs: rows.length, created: created.length },
    reason: 'evaluation assignments created (batch)',
  });

  // Notify each evaluator ONCE with how many new people they were assigned (best-effort — a
  // notification failure must never fail the assignment).
  const byEvaluator = new Map<string, number>();
  for (const r of created) byEvaluator.set(r.evaluator_id as string, (byEvaluator.get(r.evaluator_id as string) ?? 0) + 1);
  await Promise.allSettled(
    [...byEvaluator.entries()]
      .filter(([evaluatorId]) => evaluatorId !== auth.userId)
      .map(([evaluatorId, n]) =>
        notifyUser({
          userId: evaluatorId,
          storeId,
          type: 'hr_eval_assigned',
          title: 'ได้รับมอบหมายประเมินผล',
          body: `คุณได้รับมอบหมายให้ประเมิน ${n} คน`,
          data: { period_id: id, url: '/me/evaluations' },
        }).catch((e) => console.error('[assignments/batch] notify failed:', e))
      )
  );

  return NextResponse.json({
    data: { created: created.length, requested: rows.length, skipped: rows.length - created.length },
  });
}
