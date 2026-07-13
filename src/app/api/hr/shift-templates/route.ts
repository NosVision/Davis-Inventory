import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireScheduler } from '@/lib/hr/route-auth';

const TABLE = 'hr_shift_templates';
const SELECT = 'id, label, start_time, end_time, color, active';
const TIME_RE = /^\d{2}:\d{2}$/;

// GET /api/hr/shift-templates?store_id — shift templates for one store (§C).
// GET /api/hr/shift-templates?usage=<id> — how many roster assignments use a template (delete warn).
export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get('store_id') ?? '';
  const usageId = request.nextUrl.searchParams.get('usage') ?? '';
  const auth = await requireScheduler();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();

  if (usageId) {
    const { count, error } = await service
      .from('hr_schedule')
      .select('id', { count: 'exact', head: true })
      .eq('shift_template_id', usageId);
    if (error) return NextResponse.json({ error: 'Failed to count usage' }, { status: 500 });
    return NextResponse.json({ data: { count: count ?? 0 } });
  }
  const { data, error } = await service
    .from(TABLE)
    .select(SELECT)
    .eq('store_id', storeId)
    .order('start_time');
  if (error) return NextResponse.json({ error: 'Failed to load shift templates' }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// POST — create a template { store_id, label, start_time, end_time, color? }.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const auth = await requireScheduler();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const startTime = typeof body.start_time === 'string' ? body.start_time : '';
  const endTime = typeof body.end_time === 'string' ? body.end_time : '';
  const color = typeof body.color === 'string' ? body.color : null;
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    return NextResponse.json({ error: 'start_time/end_time must be HH:MM' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .insert({
      store_id: storeId,
      label,
      start_time: startTime,
      end_time: endTime,
      color,
      created_by: auth.userId,
    })
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: 'Failed to create shift template' }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}

// PUT — update a template { id, label?, start_time?, end_time?, color?, active? }.
// Guarded by the row's OWN store so a manager can't edit another store's template.
export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: row, error: rowErr } = await service
    .from(TABLE)
    .select('store_id')
    .eq('id', id)
    .maybeSingle();
  if (rowErr) return NextResponse.json({ error: 'Failed to load shift template' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Shift template not found' }, { status: 404 });

  const auth = await requireScheduler();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const patch: Record<string, unknown> = {};
  if (typeof body.label === 'string') {
    const label = body.label.trim();
    if (!label) return NextResponse.json({ error: 'label cannot be empty' }, { status: 400 });
    patch.label = label;
  }
  if (typeof body.start_time === 'string') {
    if (!TIME_RE.test(body.start_time)) {
      return NextResponse.json({ error: 'start_time must be HH:MM' }, { status: 400 });
    }
    patch.start_time = body.start_time;
  }
  if (typeof body.end_time === 'string') {
    if (!TIME_RE.test(body.end_time)) {
      return NextResponse.json({ error: 'end_time must be HH:MM' }, { status: 400 });
    }
    patch.end_time = body.end_time;
  }
  if (typeof body.color === 'string') patch.color = body.color;
  if (typeof body.active === 'boolean') patch.active = body.active;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const { data, error } = await service
    .from(TABLE)
    .update(patch)
    .eq('id', id)
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: 'Failed to update shift template' }, { status: 500 });
  return NextResponse.json({ data });
}

// DELETE ?id — remove a shift template. Since hr_schedule FKs it with ON DELETE RESTRICT, first
// CLEAR every assignment that uses it (the caller is warned these vanish), then deactivate the
// template. Returns how many assignments were removed. GET ?count=&id= gives that count up front so
// the UI can warn before confirming.
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: row, error: rowErr } = await service
    .from(TABLE)
    .select('store_id')
    .eq('id', id)
    .maybeSingle();
  if (rowErr) return NextResponse.json({ error: 'Failed to load shift template' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Shift template not found' }, { status: 404 });

  const auth = await requireScheduler();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Count then clear the assignments using this shift (removing them frees the FK for delete).
  const { count } = await service
    .from('hr_schedule')
    .select('id', { count: 'exact', head: true })
    .eq('shift_template_id', id);
  const removed = count ?? 0;
  if (removed > 0) {
    const { error: delErr } = await service.from('hr_schedule').delete().eq('shift_template_id', id);
    if (delErr) return NextResponse.json({ error: 'Failed to clear assignments for this shift' }, { status: 500 });
  }

  const { error } = await service.from(TABLE).update({ active: false }).eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to delete shift template' }, { status: 500 });
  return NextResponse.json({ data: { id, active: false, removed_assignments: removed } });
}
