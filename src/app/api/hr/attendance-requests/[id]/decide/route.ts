import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isDateInFinalizedPeriod, FINALIZED_PERIOD_ERROR } from '@/lib/hr/period-lock';

const REQUEST_TABLE = 'hr_attendance_requests';
const ATTENDANCE_TABLE = 'hr_attendance';

// POST /api/hr/attendance-requests/[id]/decide — the store manager approves or
// rejects a pending attendance correction request (§B/§J8). Every status transition is
// an atomic compare-and-set (`.eq('status','pending')`, 0 rows → 409) so a decide
// racing a concurrent cancel/decide can never clobber an already-decided row. Approval
// APPLIES the correction to hr_attendance (insert for a missing punch, update for a
// wrong-time adjustment, no-op for 'other'); because the status flip is committed
// first, an apply failure never rolls back (or hides) the approval itself — it just
// returns a warning for manual follow-up.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(REQUEST_TABLE)
    .select(
      'id, store_id, status, user_id, business_date, kind, proposed_type, proposed_ts, target_attendance_id, reason'
    )
    .eq('id', id)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: 'Failed to load attendance request' }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Attendance request not found' }, { status: 404 });

  const auth = await requireStoreManager(row.store_id as string);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if ((row.status as string) !== 'pending') {
    return NextResponse.json(
      { error: 'Only pending attendance requests can be decided' },
      { status: 409 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  if (decision === 'rejected') {
    const { data: updated, error } = await service
      .from(REQUEST_TABLE)
      .update({
        status: 'rejected',
        decided_by: auth.userId,
        decided_at: new Date().toISOString(),
        decision_note: note,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) {
      return NextResponse.json({ error: 'Failed to reject attendance request' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Already decided' }, { status: 409 });
    }

    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: REQUEST_TABLE,
      recordId: id,
      before: { status: 'pending' },
      after: { status: 'rejected', decision_note: note },
      reason: note ?? undefined,
    });

    return NextResponse.json({ data: { id, status: 'rejected' } });
  }

  if (decision === 'approved') {
    // §Phase 0B: approving APPLIES this correction into hr_attendance, which feeds payroll. Refuse
    // if the punch's pay period is already finalized (reject is still allowed — it changes nothing).
    try {
      if (await isDateInFinalizedPeriod(service, row.business_date as string, [row.store_id as string])) {
        return NextResponse.json({ error: FINALIZED_PERIOD_ERROR }, { status: 409 });
      }
    } catch {
      return NextResponse.json({ error: 'Failed to verify pay period' }, { status: 500 });
    }

    // FIRST: atomic compare-and-set flip to approved. This is the source of truth for
    // "the request was decided" — everything after this point is best-effort apply.
    const { data: updated, error } = await service
      .from(REQUEST_TABLE)
      .update({
        status: 'approved',
        decided_by: auth.userId,
        decided_at: new Date().toISOString(),
        decision_note: note,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) {
      return NextResponse.json({ error: 'Failed to approve attendance request' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Already decided' }, { status: 409 });
    }

    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: REQUEST_TABLE,
      recordId: id,
      before: { status: 'pending' },
      after: { status: 'approved', decision_note: note },
      reason: note ?? undefined,
    });

    const kind = row.kind as string;
    const applyReason = `Attendance request approved: ${row.reason as string}`.slice(0, 500);

    // THEN: apply the correction. 'other' has no auto-apply — the manager handles it
    // manually per decision_note, and the request stays applied=false.
    if (kind === 'missing_in' || kind === 'missing_out') {
      const { data: inserted, error: insertErr } = await service
        .from(ATTENDANCE_TABLE)
        .insert({
          user_id: row.user_id,
          store_id: row.store_id,
          type: row.proposed_type,
          ts: row.proposed_ts,
          business_date: row.business_date,
          is_vpn_suspect: false,
          device: 'hr_correction',
        })
        .select('id, user_id, store_id, type, ts, business_date')
        .single();

      if (insertErr) {
        console.error('Attendance request approve: failed to insert punch', {
          attendanceRequestId: id,
          userId: row.user_id,
          businessDate: row.business_date,
          error: insertErr.message,
        });
        return NextResponse.json({
          data: { id, status: 'approved' },
          warning:
            'Attendance request was approved, but creating the punch failed. Manual follow-up required.',
        });
      }

      const { error: appliedErr } = await service
        .from(REQUEST_TABLE)
        .update({ applied: true })
        .eq('id', id);
      if (appliedErr) {
        console.error('Attendance request approve: failed to mark applied', {
          attendanceRequestId: id,
          error: appliedErr.message,
        });
      }

      await logHrAudit(service, {
        actorId: auth.userId,
        action: 'create',
        table: ATTENDANCE_TABLE,
        recordId: inserted.id as string,
        before: null,
        after: inserted,
        reason: applyReason,
      });

      return NextResponse.json({ data: { id, status: 'approved' } });
    }

    if (kind === 'wrong_time') {
      const { data: before } = await service
        .from(ATTENDANCE_TABLE)
        .select('id, user_id, store_id, type, ts, business_date')
        .eq('id', row.target_attendance_id)
        .maybeSingle();

      const { data: after, error: updateErr } = await service
        .from(ATTENDANCE_TABLE)
        .update({ ts: row.proposed_ts })
        .eq('id', row.target_attendance_id)
        .select('id, user_id, store_id, type, ts, business_date')
        .single();

      if (updateErr) {
        console.error('Attendance request approve: failed to adjust punch time', {
          attendanceRequestId: id,
          targetAttendanceId: row.target_attendance_id,
          error: updateErr.message,
        });
        return NextResponse.json({
          data: { id, status: 'approved' },
          warning:
            'Attendance request was approved, but adjusting the punch time failed. Manual follow-up required.',
        });
      }

      const { error: appliedErr } = await service
        .from(REQUEST_TABLE)
        .update({ applied: true })
        .eq('id', id);
      if (appliedErr) {
        console.error('Attendance request approve: failed to mark applied', {
          attendanceRequestId: id,
          error: appliedErr.message,
        });
      }

      await logHrAudit(service, {
        actorId: auth.userId,
        action: 'update',
        table: ATTENDANCE_TABLE,
        recordId: row.target_attendance_id as string,
        before: before ?? null,
        after,
        reason: applyReason,
      });

      return NextResponse.json({ data: { id, status: 'approved' } });
    }

    // kind === 'other' — no auto-apply.
    return NextResponse.json({ data: { id, status: 'approved' } });
  }

  return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
}
