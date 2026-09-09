import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireSchedulerForScope } from '@/lib/hr/route-auth';
import { isDateInFinalizedPeriod, isRangeInFinalizedPeriod, FINALIZED_PERIOD_ERROR } from '@/lib/hr/period-lock';

const TABLE = 'hr_shift_templates';
const SELECT = 'id, label, start_time, end_time, color, active';
const TIME_RE = /^\d{2}:\d{2}$/;

// A template can still be referenced by another store after an employee/roster transfer.
// Check all references before changing their times or removing their assignments.
async function guardTemplateAssignments(
  service: ReturnType<typeof createServiceClient>,
  templateId: string,
  storeId: string | null,
  companyWide: boolean,
) {
  const byUser = new Map<string, { dates: Set<string>; stores: Set<string> }>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await service.from('hr_schedule')
      .select('id, user_id, work_date, store_id').eq('shift_template_id', templateId)
      .order('id').range(offset, offset + 499);
    if (error) return NextResponse.json({ error: 'Failed to verify assignments' }, { status: 500 });
    for (const row of data ?? []) {
      if (!companyWide && row.store_id !== storeId) {
        return NextResponse.json({ error: 'กะนี้มีตารางของสาขาอื่นใช้อยู่ — ให้ HQ/HR จัดการ' }, { status: 409 });
      }
      const employee = byUser.get(row.user_id) ?? { dates: new Set<string>(), stores: new Set<string>() };
      employee.dates.add(row.work_date);
      if (row.store_id) employee.stores.add(row.store_id);
      byUser.set(row.user_id, employee);
    }
    if ((data?.length ?? 0) < 500) break;
  }
  try {
    for (const [userId, employee] of byUser) {
      const { data, error } = await service.from('user_stores').select('store_id').eq('user_id', userId);
      if (error) throw error;
      for (const row of data ?? []) employee.stores.add(row.store_id);
      const dates = [...employee.dates].sort();
      const stores = [...employee.stores];
      // Usually one range query rules out a lock for the employee's entire template history.
      if (await isRangeInFinalizedPeriod(service, dates[0], dates[dates.length - 1], stores)) {
        for (const date of dates) {
          if (await isDateInFinalizedPeriod(service, date, stores)) {
            return NextResponse.json({ error: FINALIZED_PERIOD_ERROR }, { status: 409 });
          }
        }
      }
    }
  } catch {
    return NextResponse.json({ error: 'Failed to verify pay periods' }, { status: 500 });
  }
  return null;
}

// GET /api/hr/shift-templates?store_id — shift templates for one store (§C).
// GET /api/hr/shift-templates?usage=<id> — how many roster assignments use a template (delete warn).
export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get('store_id') ?? '';
  const usageId = request.nextUrl.searchParams.get('usage') ?? '';
  const service = createServiceClient();

  if (usageId) {
    const { data: row, error: rowErr } = await service
      .from(TABLE).select('store_id').eq('id', usageId).maybeSingle();
    if (rowErr) return NextResponse.json({ error: 'Failed to load shift template' }, { status: 500 });
    if (!row) return NextResponse.json({ error: 'Shift template not found' }, { status: 404 });
    // Resolve the template's own scope; a supplied store_id cannot grant access to another venue.
    const auth = await requireSchedulerForScope(row.store_id as string | null);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { count, error } = await service
      .from('hr_schedule')
      .select('id', { count: 'exact', head: true })
      .eq('shift_template_id', usageId);
    if (error) return NextResponse.json({ error: 'Failed to count usage' }, { status: 500 });
    return NextResponse.json({ data: { count: count ?? 0 } });
  }
  // Scope: a store's templates, a company's, or the global none-bucket (company_id='none').
  const companyParam = request.nextUrl.searchParams.get('company_id') ?? '';
  const auth = await requireSchedulerForScope(companyParam ? null : storeId || null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let listQ = service.from(TABLE).select(SELECT).order('start_time');
  if (companyParam) {
    listQ = companyParam === 'none'
      ? listQ.is('store_id', null).is('company_id', null)
      : listQ.eq('company_id', companyParam);
  } else {
    listQ = listQ.eq('store_id', storeId);
  }
  const { data, error } = await listQ;
  if (error) return NextResponse.json({ error: 'Failed to load shift templates' }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// POST — create a template { (store_id|company_id), label, start_time, end_time, color? }.
// company_id 'none' = the global bucket for staff with no company yet (both columns NULL).
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const companyParam = typeof body.company_id === 'string' ? body.company_id : '';
  const auth = await requireSchedulerForScope(companyParam ? null : storeId || null);
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
      store_id: companyParam ? null : storeId || null,
      company_id: companyParam && companyParam !== 'none' ? companyParam : null,
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

  const auth = await requireSchedulerForScope(row.store_id as string | null);
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

  if ('start_time' in patch || 'end_time' in patch || patch.active === false) {
    const blocked = await guardTemplateAssignments(service, id, row.store_id, auth.fullHr || auth.role === 'hq');
    if (blocked) return blocked;
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
// template. Returns how many assignments were removed. GET ?usage=<id> gives that count up front so
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

  const auth = await requireSchedulerForScope(row.store_id as string | null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const blocked = await guardTemplateAssignments(service, id, row.store_id, auth.fullHr || auth.role === 'hq');
  if (blocked) return blocked;

  // Count then clear the assignments using this shift (removing them frees the FK for delete).
  const { count, error: countErr } = await service
    .from('hr_schedule')
    .select('id', { count: 'exact', head: true })
    .eq('shift_template_id', id);
  if (countErr) return NextResponse.json({ error: 'Failed to count usage' }, { status: 500 });
  const removed = count ?? 0;
  if (removed > 0) {
    const { error: delErr } = await service.from('hr_schedule').delete().eq('shift_template_id', id);
    if (delErr) return NextResponse.json({ error: 'Failed to clear assignments for this shift' }, { status: 500 });
  }

  const { error } = await service.from(TABLE).update({ active: false }).eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to delete shift template' }, { status: 500 });
  return NextResponse.json({ data: { id, active: false, removed_assignments: removed } });
}
