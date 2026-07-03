import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { DEFAULT_EVAL_CRITERIA, sumMaxScore, parseEvalPeriod, EVAL_PERIOD_STATUSES } from '@/lib/hr/eval-config';

const PERIODS = 'hr_eval_periods';
const CRITERIA = 'hr_eval_criteria';

// GET /api/hr/eval/periods — list evaluation periods (HR). Newest first.
export async function GET(_request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data, error } = await service
    .from(PERIODS)
    .select('*')
    .order('period_month', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/hr/eval/periods — create a period (status draft) and seed the §E 15-criteria
// template so HR starts from a working set; max_score caches Σ criteria points.
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseEvalPeriod(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const seed = body.seed_default_criteria !== false; // default true
  const maxScore = seed ? sumMaxScore([...DEFAULT_EVAL_CRITERIA]) : 0;

  const service = createServiceClient();
  const { data: period, error } = await service
    .from(PERIODS)
    .insert({ ...parsed.fields, max_score: maxScore, status: 'draft', created_by: auth.userId })
    .select('*')
    .single();
  // Multiple periods per month are intentionally allowed (§G: store-scoped periods let HR-A run
  // a different period than HR-B in the same month), so there is no month-uniqueness 409.
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (seed) {
    const rows = DEFAULT_EVAL_CRITERIA.map((c) => ({ period_id: period.id, ...c }));
    const { error: critErr } = await service.from(CRITERIA).insert(rows);
    if (critErr) {
      // roll back the period so we don't leave one with a max_score but no criteria
      await service.from(PERIODS).delete().eq('id', period.id);
      return NextResponse.json({ error: 'Failed to seed criteria' }, { status: 500 });
    }
  }

  await logHrAudit(service, {
    actorId: auth.userId, action: 'create', table: PERIODS, recordId: period.id as string,
    before: null, after: period, reason: 'evaluation period created',
  });
  return NextResponse.json({ data: period }, { status: 201 });
}

// PATCH /api/hr/eval/periods — edit a draft period's title/scope, or transition status
// (draft→open→closed, or →void). Compute-on-close is a separate endpoint; this only flips
// the flag. Title/scope edits are allowed only while draft.
export async function PATCH(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: before, error: fetchErr } = await service.from(PERIODS).select('*').eq('id', id).maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: 'Period not found' }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.status === 'string') {
    if (!EVAL_PERIOD_STATUSES.includes(body.status as (typeof EVAL_PERIOD_STATUSES)[number])) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }
    patch.status = body.status;
    if (body.status === 'open' && typeof body.scoring_closes_at === 'string') patch.scoring_closes_at = body.scoring_closes_at;
  }
  if (typeof body.title === 'string' || typeof body.scope_type === 'string') {
    if (before.status !== 'draft') {
      return NextResponse.json({ error: 'title/scope can only be edited while draft' }, { status: 409 });
    }
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
    if (body.scope_type === 'company' || body.scope_type === 'stores') patch.scope_type = body.scope_type;
  }
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { data, error } = await service.from(PERIODS).update(patch).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: PERIODS, recordId: id,
    before, after: data, reason: 'evaluation period updated',
  });
  return NextResponse.json({ data });
}
