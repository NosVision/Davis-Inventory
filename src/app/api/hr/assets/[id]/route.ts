import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { bahtToSatang } from '@/lib/pos/money';
import { isForeignKeyViolation, isUniqueViolation } from '@/lib/hr/db-errors';

const TABLE = 'hr_assets';
const ALLOWED_STATUSES = ['in_stock', 'issued', 'returned', 'lost', 'damaged'];

// PUT /api/hr/assets/[id] — partial update.
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
  if (fetchErr || !current) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  const update: Record<string, unknown> = { updated_by: auth.userId };
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    update.name = name;
  }
  if ('category' in body) {
    update.category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null;
  }
  if ('asset_code' in body) {
    update.asset_code = typeof body.asset_code === 'string' && body.asset_code.trim() ? body.asset_code.trim() : null;
  }
  if ('holder_id' in body) {
    update.holder_id = typeof body.holder_id === 'string' && body.holder_id ? body.holder_id : null;
  }
  if ('value_baht' in body) {
    const raw = Number(body.value_baht);
    if (!Number.isFinite(raw) || raw < 0) {
      return NextResponse.json({ error: 'Value must be a non-negative number' }, { status: 400 });
    }
    update.value_satang = bahtToSatang(raw);
  }
  if ('status' in body) {
    const status = body.status;
    if (typeof status !== 'string' || !ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    update.status = status;
  }
  if ('issued_date' in body) {
    update.issued_date = typeof body.issued_date === 'string' && body.issued_date ? body.issued_date : null;
  }
  if ('returned_date' in body) {
    update.returned_date = typeof body.returned_date === 'string' && body.returned_date ? body.returned_date : null;
  }
  if ('notes' in body) {
    update.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
  }

  // Effective holder must be consistent with effective status.
  const effectiveStatus = ('status' in update ? update.status : current.status) as string;
  const effectiveHolderId = ('holder_id' in update ? update.holder_id : current.holder_id) as string | null;
  if (effectiveStatus === 'issued' && !effectiveHolderId) {
    return NextResponse.json({ error: 'An issued asset requires a holder' }, { status: 400 });
  }
  if (effectiveStatus === 'returned' || effectiveStatus === 'in_stock') {
    update.holder_id = null;
  }

  const { data, error } = await service
    .from(TABLE)
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: 'Asset code already exists' }, { status: 409 });
    if (isForeignKeyViolation(error)) return NextResponse.json({ error: 'Holder not found' }, { status: 400 });
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

// DELETE /api/hr/assets/[id] — hard delete (no incoming FK, always succeeds).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();
  const { data: current, error: fetchErr } = await service.from(TABLE).select('*').eq('id', id).single();
  if (fetchErr || !current) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  const { error } = await service.from(TABLE).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'delete',
    table: TABLE,
    recordId: id,
    before: current,
    after: null,
  });

  return NextResponse.json({ success: true });
}
