import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForEmployeeProfile } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TABLE = 'hr_timesheet_overrides';
const COLS = 'id, user_id, business_date, store_id, worked_min, late_min, ot_min, absent, note, reason, edited_by, updated_at';

function isCalendarDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

// A nullable non-negative-integer override field: undefined → not sent, null → clear, else int.
// Returns valid:false when a non-null value is present but not a non-negative integer.
function optInt(v: unknown): { valid: boolean; value: number | null | undefined } {
  if (v === undefined) return { valid: true, value: undefined };
  if (v === null) return { valid: true, value: null };
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return { valid: true, value: v };
  return { valid: false, value: undefined };
}

// PUT /api/hr/timesheet/override — HR corrects a derived timesheet day (§J8/§B).
// HR-only (requireHrManager). A reason is mandatory; every write is audited. The override
// layers over the derived metrics — the underlying punches are never modified.
export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.user_id === 'string' ? body.user_id : '';
  const businessDate = typeof body.business_date === 'string' ? body.business_date : '';
  const storeId = typeof body.store_id === 'string' ? body.store_id : null;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null;

  if (!userId || !isCalendarDate(businessDate)) {
    return NextResponse.json({ error: 'user_id and a valid business_date are required' }, { status: 400 });
  }
  // §P5.5: only company-wide HR or a manager whose stores include this employee may override.
  const auth = await requireHrManagerForEmployeeProfile(userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required for a timesheet override' }, { status: 400 });
  }

  const w = optInt(body.worked_min);
  const l = optInt(body.late_min);
  const o = optInt(body.ot_min);
  if (!w.valid || !l.valid || !o.valid) {
    return NextResponse.json({ error: 'worked_min/late_min/ot_min must be non-negative integers' }, { status: 400 });
  }
  const workedMin = w.value;
  const lateMin = l.value;
  const otMin = o.value;
  const absent = typeof body.absent === 'boolean' ? body.absent : body.absent === null ? null : undefined;

  const service = createServiceClient();

  // Snapshot the prior override (if any) for the audit trail.
  const { data: before } = await service
    .from(TABLE)
    .select(COLS)
    .eq('user_id', userId)
    .eq('business_date', businessDate)
    .maybeSingle();

  const row = {
    user_id: userId,
    business_date: businessDate,
    store_id: storeId,
    worked_min: workedMin === undefined ? (before?.worked_min ?? null) : workedMin,
    late_min: lateMin === undefined ? (before?.late_min ?? null) : lateMin,
    ot_min: otMin === undefined ? (before?.ot_min ?? null) : otMin,
    absent: absent === undefined ? (before?.absent ?? null) : absent,
    note,
    reason,
    edited_by: auth.userId,
  };

  const { data, error } = await service
    .from(TABLE)
    .upsert(row, { onConflict: 'user_id,business_date' })
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: 'Failed to save override' }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: before ? 'update' : 'create',
    table: TABLE,
    recordId: data.id as string,
    before: before ?? null,
    after: data,
    reason,
  });

  return NextResponse.json({ data });
}

// DELETE /api/hr/timesheet/override?user_id&business_date — remove an override (revert to
// the derived values). HR-only; audited.
export async function DELETE(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const userId = sp.get('user_id') ?? '';
  const businessDate = sp.get('business_date') ?? '';
  if (!userId || !isCalendarDate(businessDate)) {
    return NextResponse.json({ error: 'user_id and a valid business_date are required' }, { status: 400 });
  }
  // §P5.5: gate on the employee's stores.
  const auth = await requireHrManagerForEmployeeProfile(userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data: before } = await service
    .from(TABLE)
    .select(COLS)
    .eq('user_id', userId)
    .eq('business_date', businessDate)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'Override not found' }, { status: 404 });

  const { error } = await service
    .from(TABLE)
    .delete()
    .eq('user_id', userId)
    .eq('business_date', businessDate);
  if (error) return NextResponse.json({ error: 'Failed to remove override' }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'delete',
    table: TABLE,
    recordId: before.id as string,
    before,
    after: null,
    reason: 'override removed',
  });

  return NextResponse.json({ data: { user_id: userId, business_date: businessDate, removed: true } });
}
