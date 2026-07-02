import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isForeignKeyViolation } from '@/lib/hr/db-errors';

const TABLE = 'hr_policies';

// PUT /api/hr/policies/[id] — partial update { title?, category?, body?, active?, sort_order?, bumpVersion? }.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const service = createServiceClient();
  const { data: current, error: fetchErr } = await service
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !current) return NextResponse.json({ error: 'Policy not found' }, { status: 404 });

  const update: Record<string, unknown> = {};
  let contentChanged = false;

  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    update.title = title;
    if (title !== current.title) contentChanged = true;
  }
  if ('category' in body) {
    update.category = typeof body.category === 'string' ? body.category.trim() : null;
  }
  if ('body' in body) {
    const policyBody = typeof body.body === 'string' ? body.body : null;
    update.body = policyBody;
    if (policyBody !== current.body) contentChanged = true;
  }
  if ('sort_order' in body) update.sort_order = Number(body.sort_order) || 0;
  if ('active' in body) {
    if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'active must be boolean' }, { status: 400 });
    update.active = body.active;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  // Version bump rule: an explicit bumpVersion flag, or a change to the policy
  // title/body, publishes a new version so employees must re-acknowledge.
  if (body.bumpVersion === true || contentChanged) {
    update.version = (Number(current.version) || 0) + 1;
  }

  update.updated_by = auth.userId;

  const { data, error } = await service
    .from(TABLE)
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    before: current,
    after: data,
  });

  return NextResponse.json({ data });
}

// DELETE /api/hr/policies/[id] — hard delete; acks cascade, 409 guard kept for safety.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();
  const { data: current, error: fetchErr } = await service.from(TABLE).select('*').eq('id', id).single();
  if (fetchErr || !current) return NextResponse.json({ error: 'Policy not found' }, { status: 404 });

  const { error } = await service.from(TABLE).delete().eq('id', id);
  if (error) {
    if (isForeignKeyViolation(error)) {
      return NextResponse.json({ error: 'in use' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'delete',
    table: TABLE,
    recordId: id,
    before: current ?? null,
    after: null,
  });

  return NextResponse.json({ success: true });
}
