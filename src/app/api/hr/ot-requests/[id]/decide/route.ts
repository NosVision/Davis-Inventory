import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const OT_TABLE = 'hr_ot_requests';
const OVERRIDE_TABLE = 'hr_timesheet_overrides';
const OVERRIDE_COLS =
  'id, user_id, business_date, store_id, worked_min, late_min, ot_min, absent, note, reason, edited_by, updated_at';

// A nullable non-negative-integer field: undefined → not sent, null → clear, else int.
// Returns valid:false when a non-null value is present but not a non-negative integer.
function optInt(v: unknown): { valid: boolean; value: number | null | undefined } {
  if (v === undefined) return { valid: true, value: undefined };
  if (v === null) return { valid: true, value: null };
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return { valid: true, value: v };
  return { valid: false, value: undefined };
}

// POST /api/hr/ot-requests/[id]/decide — the store manager approves or rejects a
// pending OT request (§B/§J8). Every status transition is an atomic compare-and-set
// (`.eq('status','pending')`, 0 rows → 409) so a decide racing a concurrent
// cancel/decide can never clobber an already-decided row. Approval APPLIES the OT to
// the employee's hr_timesheet_overrides row for that day; because the status flip is
// committed first, an apply failure never rolls back (or hides) the approval itself —
// it just returns a warning for manual follow-up.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(OT_TABLE)
    .select('id, store_id, status, user_id, work_date, requested_ot_min, reason')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load OT request' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'OT request not found' }, { status: 404 });

  const auth = await requireStoreManager(row.store_id as string);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if ((row.status as string) !== 'pending') {
    return NextResponse.json({ error: 'Only pending OT requests can be decided' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  if (decision === 'rejected') {
    const { data: updated, error } = await service
      .from(OT_TABLE)
      .update({
        status: 'rejected',
        decided_by: auth.userId,
        decided_at: new Date().toISOString(),
        decision_note: note,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) return NextResponse.json({ error: 'Failed to reject OT request' }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Already decided' }, { status: 409 });
    }

    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: OT_TABLE,
      recordId: id,
      before: { status: 'pending' },
      after: { status: 'rejected', decision_note: note },
      reason: note ?? undefined,
    });

    return NextResponse.json({ data: { id, status: 'rejected' } });
  }

  if (decision === 'approved') {
    const decidedOtMin = optInt(body.decided_ot_min);
    if (!decidedOtMin.valid) {
      return NextResponse.json(
        { error: 'decided_ot_min must be a non-negative integer' },
        { status: 400 }
      );
    }
    const finalOtMin =
      decidedOtMin.value === undefined || decidedOtMin.value === null
        ? (row.requested_ot_min as number)
        : decidedOtMin.value;

    // FIRST: atomic compare-and-set flip to approved. This is the source of truth for
    // "the request was decided" — everything after this point is best-effort apply.
    const { data: updated, error } = await service
      .from(OT_TABLE)
      .update({
        status: 'approved',
        decided_by: auth.userId,
        decided_at: new Date().toISOString(),
        decision_note: note,
        decided_ot_min: finalOtMin,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) return NextResponse.json({ error: 'Failed to approve OT request' }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Already decided' }, { status: 409 });
    }

    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: OT_TABLE,
      recordId: id,
      before: { status: 'pending' },
      after: { status: 'approved', decision_note: note, decided_ot_min: finalOtMin },
      reason: note ?? undefined,
    });

    // THEN: apply — merge the OT into the day's timesheet override, preserving any
    // existing worked_min/late_min/absent/store_id already recorded for that day.
    const { data: before } = await service
      .from(OVERRIDE_TABLE)
      .select(OVERRIDE_COLS)
      .eq('user_id', row.user_id)
      .eq('business_date', row.work_date)
      .maybeSingle();

    const overrideReason = `OT request approved: ${row.reason as string}`.slice(0, 500);
    const overrideRow = {
      user_id: row.user_id,
      business_date: row.work_date,
      store_id: before?.store_id ?? (row.store_id as string),
      worked_min: before?.worked_min ?? null,
      late_min: before?.late_min ?? null,
      ot_min: finalOtMin,
      absent: before?.absent ?? null,
      note: before?.note ?? null,
      reason: overrideReason,
      edited_by: auth.userId,
    };

    const { data: after, error: applyErr } = await service
      .from(OVERRIDE_TABLE)
      .upsert(overrideRow, { onConflict: 'user_id,business_date' })
      .select(OVERRIDE_COLS)
      .single();

    if (applyErr) {
      // The approval already committed above — do NOT throw a 500 here, that would
      // mislead the caller into retrying an already-approved request. Surface a
      // warning instead so the manager can apply the override manually.
      console.error('OT approve: failed to apply timesheet override', {
        otRequestId: id,
        userId: row.user_id,
        businessDate: row.work_date,
        error: applyErr.message,
      });
      return NextResponse.json({
        data: { id, status: 'approved', applied_ot_min: finalOtMin },
        warning:
          'OT request was approved, but applying it to the timesheet override failed. Manual follow-up required.',
      });
    }

    await logHrAudit(service, {
      actorId: auth.userId,
      action: before ? 'update' : 'create',
      table: OVERRIDE_TABLE,
      recordId: after.id as string,
      before: before ?? null,
      after,
      reason: overrideReason,
    });

    return NextResponse.json({ data: { id, status: 'approved', applied_ot_min: finalOtMin } });
  }

  return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
}
