import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isUniqueViolation } from '@/lib/hr/db-errors';
import { isCalendarDate } from '@/lib/hr/leaves';

const TABLE = 'hr_holidays';
const SELECT = '*, company:hr_companies(id, name)';

// PUT /api/hr/holidays/[id] — partial update { holiday_date?, name_th?, name_en?, is_public_holiday?, active? }.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  if ('holiday_date' in body) {
    const holidayDate = typeof body.holiday_date === 'string' ? body.holiday_date.trim() : '';
    if (!isCalendarDate(holidayDate)) {
      return NextResponse.json({ error: 'holiday_date must be a valid YYYY-MM-DD date' }, { status: 400 });
    }
    update.holiday_date = holidayDate;
  }
  if ('name_th' in body) {
    const nameTh = typeof body.name_th === 'string' ? body.name_th.trim() : '';
    if (!nameTh) return NextResponse.json({ error: 'name_th is required' }, { status: 400 });
    update.name_th = nameTh;
  }
  if ('name_en' in body) {
    const nameEn = typeof body.name_en === 'string' ? body.name_en.trim() : '';
    if (!nameEn) return NextResponse.json({ error: 'name_en is required' }, { status: 400 });
    update.name_en = nameEn;
  }
  for (const key of ['is_public_holiday', 'active'] as const) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') {
        return NextResponse.json({ error: `${key} must be boolean` }, { status: 400 });
      }
      update[key] = body[key];
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: current, error: fetchErr } = await service
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !current) {
    return NextResponse.json({ error: 'Holiday not found' }, { status: 404 });
  }

  const { data, error } = await service
    .from(TABLE)
    .update(update)
    .eq('id', id)
    .select(SELECT)
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'A holiday already exists on this date' }, { status: 409 });
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

// DELETE /api/hr/holidays/[id] — hard delete (calendar data, not referenced).
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
    return NextResponse.json({ error: 'Holiday not found' }, { status: 404 });
  }

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
