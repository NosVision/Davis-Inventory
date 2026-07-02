import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isForeignKeyViolation } from '@/lib/hr/db-errors';

const TABLE = 'hr_announcements';
const STORES_TABLE = 'hr_announcement_stores';

// PUT /api/hr/announcements/[id] — partial update { title?, body?, active?, storeIds? }.
// When storeIds is present (an array) the scope is fully replaced: existing join rows
// are deleted and the new set inserted (empty array = company-wide).
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
  if (fetchErr || !current)
    return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });

  const update: Record<string, unknown> = {};

  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    update.title = title;
  }
  if ('body' in body) {
    update.body = typeof body.body === 'string' ? body.body : null;
  }
  if ('active' in body) {
    if (typeof body.active !== 'boolean')
      return NextResponse.json({ error: 'active must be boolean' }, { status: 400 });
    update.active = body.active;
  }

  const hasScope = Array.isArray(body.storeIds);
  const storeIds = hasScope
    ? (body.storeIds as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];

  if (Object.keys(update).length === 0 && !hasScope) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  update.updated_by = auth.userId;

  const { data: updated, error } = await service
    .from(TABLE)
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });

  // Replace scope atomically when storeIds was supplied. The SECURITY DEFINER RPC
  // deletes existing join rows and inserts the deduped set in one transaction and
  // rolls back on any invalid store_id, so scope can never end up empty on partial
  // failure. An empty array leaves zero rows = company-wide (all branches).
  const deduped = [...new Set(storeIds.filter((s): s is string => typeof s === 'string'))];
  if (hasScope) {
    const { error: scopeErr } = await service.rpc('hr_set_announcement_stores', {
      p_announcement_id: id,
      p_store_ids: deduped,
    });
    if (scopeErr) return NextResponse.json({ error: scopeErr.message }, { status: 500 });
  }

  let finalStoreIds: string[];
  if (hasScope) {
    finalStoreIds = deduped;
  } else {
    const { data: scopeRows } = await service
      .from(STORES_TABLE)
      .select('store_id')
      .eq('announcement_id', id);
    finalStoreIds = (scopeRows ?? []).map((r) => r.store_id as string);
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    before: current,
    after: updated,
  });

  return NextResponse.json({ data: { ...updated, store_ids: finalStoreIds } });
}

// DELETE /api/hr/announcements/[id] — hard delete; scope + receipts cascade, 409 guard
// kept for safety against unexpected FK references.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();
  const { data: current, error: fetchErr } = await service
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !current)
    return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });

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
