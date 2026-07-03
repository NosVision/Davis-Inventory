import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isUniqueViolation } from '@/lib/hr/db-errors';
import { collectLeaveTypeFields } from '@/lib/hr/leave-types';

const TABLE = 'hr_leave_types';
const SELECT = '*, company:hr_companies(id, name)';

// PUT /api/hr/leave-types/[id] — partial update (code is immutable).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const parsed = collectLeaveTypeFields(body, false);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const update = { ...parsed.fields };
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }
  update.updated_by = auth.userId;

  const service = createServiceClient();
  const { data: current, error: fetchErr } = await service
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !current) {
    return NextResponse.json({ error: 'Leave type not found' }, { status: 404 });
  }

  const { data, error } = await service
    .from(TABLE)
    .update(update)
    .eq('id', id)
    .select(SELECT)
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'A leave type with this code already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

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

// DELETE /api/hr/leave-types/[id] — SOFT delete (active=false); types may be
// referenced by hr_leaves, so never hard-delete.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();
  const { data: current, error: fetchErr } = await service
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !current) {
    return NextResponse.json({ error: 'Leave type not found' }, { status: 404 });
  }

  const { data, error } = await service
    .from(TABLE)
    .update({ active: false, updated_by: auth.userId })
    .eq('id', id)
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'delete',
    table: TABLE,
    recordId: id,
    before: current,
    after: data,
  });

  return NextResponse.json({ data });
}
