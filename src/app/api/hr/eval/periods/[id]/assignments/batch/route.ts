import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyUser } from '@/lib/notifications/service';

const ASSIGNMENTS = 'hr_eval_assignments';
const TEMPLATES = 'hr_eval_assignment_templates';
// Guard rails so a mis-click can't fan out an unbounded number of inserts/notifications.
const MAX_PER_SIDE = 200;
const MAX_PAIRS = 4000;

interface Row { period_id: string; evaluator_id: string; employee_id: string; store_id: string | null }

// POST /api/hr/eval/periods/[id]/assignments/batch — assign a GROUP of evaluators to a GROUP of
// evaluatees in one action (§Phase 4). Two modes:
//   • cartesian: { store_id?, evaluator_ids[], employee_ids[] } → the product (evaluator × employee)
//   • template:  { template_id }                               → apply a saved per-store template
// Self-pairs and already-existing pairs are skipped; each row is stamped with the store; each
// evaluator is notified ONCE (not per evaluatee). HR-only.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const service = createServiceClient();

  let rows: Row[] = [];

  if (typeof body.template_id === 'string' && body.template_id) {
    // Template mode: pull the saved pairs + store, then keep only pairs whose people still exist.
    const { data: tpl, error: tErr } = await service
      .from(TEMPLATES)
      .select('store_id, pairs')
      .eq('id', body.template_id)
      .maybeSingle();
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
    if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

    const rawPairs = Array.isArray(tpl.pairs) ? (tpl.pairs as { evaluator_id?: unknown; employee_id?: unknown }[]) : [];
    const wanted = rawPairs
      .map((p) => ({ evaluator_id: String(p.evaluator_id ?? ''), employee_id: String(p.employee_id ?? '') }))
      .filter((p) => p.evaluator_id && p.employee_id && p.evaluator_id !== p.employee_id);
    if (wanted.length === 0) return NextResponse.json({ error: 'Template has no valid pairs' }, { status: 400 });

    // Drop pairs referencing people who were hard-deleted, so one stale id can't fail the whole apply.
    const ids = [...new Set(wanted.flatMap((p) => [p.evaluator_id, p.employee_id]))];
    const { data: profs } = await service.from('profiles').select('id').in('id', ids);
    const live = new Set((profs ?? []).map((r) => r.id as string));
    rows = wanted
      .filter((p) => live.has(p.evaluator_id) && live.has(p.employee_id))
      .map((p) => ({ period_id: id, evaluator_id: p.evaluator_id, employee_id: p.employee_id, store_id: (tpl.store_id as string) ?? null }));
    if (rows.length === 0) return NextResponse.json({ error: 'No template pairs match current staff' }, { status: 400 });
  } else {
    // Cartesian mode.
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
    for (const evaluatorId of evaluatorIds) {
      for (const employeeId of employeeIds) {
        if (evaluatorId === employeeId) continue;
        rows.push({ period_id: id, evaluator_id: evaluatorId, employee_id: employeeId, store_id: storeId });
      }
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No valid pairs (evaluator and evaluatee are the same)' }, { status: 400 });
    }
  }

  if (rows.length > MAX_PAIRS) {
    return NextResponse.json({ error: `Too many pairs (${rows.length}); narrow the selection` }, { status: 400 });
  }

  // ON CONFLICT DO NOTHING on the (period, evaluator, employee) unique key — existing pairs are
  // silently skipped, and .select() returns ONLY the freshly-inserted rows.
  const { data: inserted, error } = await service
    .from(ASSIGNMENTS)
    .upsert(rows, { onConflict: 'period_id,evaluator_id,employee_id', ignoreDuplicates: true })
    .select('id, evaluator_id, employee_id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const created = inserted ?? [];
  await logHrAudit(service, {
    actorId: auth.userId, action: 'create', table: ASSIGNMENTS, recordId: id,
    before: null,
    after: { via: body.template_id ? 'template' : 'matrix', requested_pairs: rows.length, created: created.length },
    reason: 'evaluation assignments created (batch)',
  });

  // Notify each evaluator ONCE with how many new people they were assigned (best-effort).
  const byEvaluator = new Map<string, number>();
  for (const r of created) byEvaluator.set(r.evaluator_id as string, (byEvaluator.get(r.evaluator_id as string) ?? 0) + 1);
  const storeForNotify = rows[0]?.store_id ?? null;
  await Promise.allSettled(
    [...byEvaluator.entries()]
      .filter(([evaluatorId]) => evaluatorId !== auth.userId)
      .map(([evaluatorId, n]) =>
        notifyUser({
          userId: evaluatorId,
          storeId: storeForNotify,
          type: 'hr_eval_assigned',
          title: 'ได้รับมอบหมายประเมินผล',
          body: `คุณได้รับมอบหมายให้ประเมิน ${n} คน`,
          titleKey: 'notificationTemplates.evalAssigned.title',
          bodyKey: 'notificationTemplates.evalAssigned.bodyMany',
          params: { count: n },
          data: { period_id: id, url: '/me/evaluations' },
        }).catch((e) => console.error('[assignments/batch] notify failed:', e))
      )
  );

  return NextResponse.json({
    data: { created: created.length, requested: rows.length, skipped: rows.length - created.length },
  });
}
