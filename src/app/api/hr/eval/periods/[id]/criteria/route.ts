import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { sumMaxScore } from '@/lib/hr/eval-config';

const PERIODS = 'hr_eval_periods';
const CRITERIA = 'hr_eval_criteria';

// Criteria are editable only while the period is DRAFT (§G: locked once scoring opens). Every
// mutation recomputes the period's max_score cache (Σ max_points) so results normalize correctly.

async function recomputeMaxScore(service: ReturnType<typeof createServiceClient>, periodId: string): Promise<number> {
  const { data } = await service.from(CRITERIA).select('max_points').eq('period_id', periodId);
  const max = sumMaxScore((data ?? []) as { max_points: number }[]);
  await service.from(PERIODS).update({ max_score: max, updated_at: new Date().toISOString() }).eq('id', periodId);
  return max;
}

// GET /api/hr/eval/periods/[id]/criteria — list a period's criteria (sorted).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const service = createServiceClient();
  const { data, error } = await service.from(CRITERIA).select('*').eq('period_id', id).order('sort_order');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

async function assertDraft(service: ReturnType<typeof createServiceClient>, periodId: string) {
  const { data } = await service.from(PERIODS).select('id, status').eq('id', periodId).maybeSingle();
  return data;
}

// POST /api/hr/eval/periods/[id]/criteria — add a criterion (draft only). Recomputes max_score.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const maxPoints = Number(body.max_points);
  const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0;
  const description = typeof body.description === 'string' ? body.description.slice(0, 500) : null;
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!Number.isInteger(maxPoints) || maxPoints <= 0) {
    return NextResponse.json({ error: 'max_points must be a positive integer' }, { status: 400 });
  }

  const service = createServiceClient();
  const period = await assertDraft(service, id);
  if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 });
  if (period.status !== 'draft') {
    return NextResponse.json({ error: 'criteria can only be edited while the period is draft' }, { status: 409 });
  }

  const { data, error } = await service
    .from(CRITERIA)
    .insert({ period_id: id, name, max_points: maxPoints, sort_order: sortOrder, description })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const maxScore = await recomputeMaxScore(service, id);
  await logHrAudit(service, {
    actorId: auth.userId, action: 'create', table: CRITERIA, recordId: data.id as string,
    before: null, after: data, reason: 'evaluation criterion added',
  });
  return NextResponse.json({ data, max_score: maxScore }, { status: 201 });
}

// PATCH /api/hr/eval/periods/[id]/criteria — edit a criterion (draft only). Recomputes max_score.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const criterionId = typeof body.criterion_id === 'string' ? body.criterion_id : '';
  if (!criterionId) return NextResponse.json({ error: 'criterion_id is required' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (body.max_points !== undefined) {
    const mp = Number(body.max_points);
    if (!Number.isInteger(mp) || mp <= 0) return NextResponse.json({ error: 'max_points must be a positive integer' }, { status: 400 });
    patch.max_points = mp;
  }
  if (body.sort_order !== undefined && Number.isFinite(Number(body.sort_order))) patch.sort_order = Number(body.sort_order);
  if (typeof body.description === 'string') patch.description = body.description.slice(0, 500);
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

  const service = createServiceClient();
  const period = await assertDraft(service, id);
  if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 });
  if (period.status !== 'draft') {
    return NextResponse.json({ error: 'criteria can only be edited while the period is draft' }, { status: 409 });
  }

  const { data: before } = await service.from(CRITERIA).select('*').eq('id', criterionId).eq('period_id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Criterion not found' }, { status: 404 });

  const { data, error } = await service.from(CRITERIA).update(patch).eq('id', criterionId).eq('period_id', id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const maxScore = await recomputeMaxScore(service, id);
  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: CRITERIA, recordId: criterionId,
    before, after: data, reason: 'evaluation criterion updated',
  });
  return NextResponse.json({ data, max_score: maxScore });
}

// DELETE /api/hr/eval/periods/[id]/criteria?criterion_id= — remove (draft only). Recomputes.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const criterionId = request.nextUrl.searchParams.get('criterion_id') ?? '';
  if (!criterionId) return NextResponse.json({ error: 'criterion_id is required' }, { status: 400 });

  const service = createServiceClient();
  const period = await assertDraft(service, id);
  if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 });
  if (period.status !== 'draft') {
    return NextResponse.json({ error: 'criteria can only be edited while the period is draft' }, { status: 409 });
  }

  const { data: before } = await service.from(CRITERIA).select('*').eq('id', criterionId).eq('period_id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Criterion not found' }, { status: 404 });

  const { error } = await service.from(CRITERIA).delete().eq('id', criterionId).eq('period_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const maxScore = await recomputeMaxScore(service, id);
  await logHrAudit(service, {
    actorId: auth.userId, action: 'delete', table: CRITERIA, recordId: criterionId,
    before, after: null, reason: 'evaluation criterion removed',
  });
  return NextResponse.json({ data: { id: criterionId, removed: true }, max_score: maxScore });
}
