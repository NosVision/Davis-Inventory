import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_departments';

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' || (error.message ?? '').toLowerCase().includes('duplicate');
}

function isForeignKeyViolation(error: { code?: string; message?: string }): boolean {
  return error.code === '23503' || (error.message ?? '').toLowerCase().includes('foreign key');
}

// PUT /api/hr/departments/[id] — partial update { name?, active? }.
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
  if (fetchErr || !current) return NextResponse.json({ error: 'Department not found' }, { status: 404 });

  const update: Record<string, unknown> = {};
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    update.name = name;
  }
  if ('active' in body) update.active = Boolean(body.active);

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const { data, error } = await service
    .from(TABLE)
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'A department with this name already exists' }, { status: 409 });
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

// DELETE /api/hr/departments/[id] — hard delete; 409 if referenced by an employee.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();
  const { data: current } = await service.from(TABLE).select('*').eq('id', id).single();

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
