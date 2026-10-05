import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForEmployeeProfile } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isRangeInFinalizedPeriod, employeeStoreIds, FINALIZED_PERIOD_ERROR } from '@/lib/hr/period-lock';
import { revertLeaveOverrides } from '@/lib/hr/leave-cancel';
import { notifyUser } from '@/lib/notifications/service';

const TABLE = 'hr_leaves';
const COLS =
  'id, user_id, store_id, company_id, leave_type_id, from_date, to_date, days, reason, status, approver_id, decided_at, decision_note';

// DELETE /api/hr/leaves/[id] — HR cancels a leave by soft-cancelling it (status='cancelled').
// Used from the timesheet day-edit modal when HR reclassifies a day away from "leave" (owner ask
// 2026-07-10) and from the approved queue on /hr/leaves (owner ask 2026-10-05). Optional body
// { reason }. The row is kept for the audit trail, not hard-deleted. §P5.5: company-wide HR, or a
// manager whose stores include this employee.
//
// What follows from the cancel:
//   • quota — computed live from approved + pending rows, so the days return at once;
//   • timesheet — the overrides approval wrote are undone (lib/hr/leave-cancel.ts);
//   • payroll — read at generation time, so a DRAFT run picks it up on คำนวณใหม่, and a FINALIZED
//     period refuses the cancel outright (below).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const cancelReason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  const service = createServiceClient();

  const { data: before, error: loadErr } = await service
    .from(TABLE)
    .select(COLS)
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load leave' }, { status: 500 });
  if (!before) return NextResponse.json({ error: 'Leave not found' }, { status: 404 });

  const auth = await requireHrManagerForEmployeeProfile(before.user_id as string);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (before.status === 'cancelled') {
    return NextResponse.json({ data: before }); // already cancelled — idempotent
  }
  if (before.status === 'rejected') {
    return NextResponse.json({ error: 'A rejected leave cannot be cancelled' }, { status: 409 });
  }

  // §Phase 0B: cancelling an APPROVED leave removes paid/absent days that fed payroll. Refuse if the
  // leave overlaps a finalized period (a pending leave has no payroll effect, so it stays cancellable).
  const wasApproved = before.status === 'approved';
  if (wasApproved) {
    try {
      const storeIds = await employeeStoreIds(service, before.user_id as string, before.store_id as string | null);
      if (await isRangeInFinalizedPeriod(service, before.from_date as string, before.to_date as string, storeIds)) {
        return NextResponse.json({ error: FINALIZED_PERIOD_ERROR }, { status: 409 });
      }
    } catch {
      return NextResponse.json({ error: 'Failed to verify pay period' }, { status: 500 });
    }
  }

  // Compare-and-set on the status read above, so a cancel racing an approve never leaves an
  // approved leave's timesheet days un-reverted.
  const { data: rows, error } = await service
    .from(TABLE)
    .update({ status: 'cancelled', decided_at: new Date().toISOString(), approver_id: auth.userId })
    .eq('id', id)
    .eq('status', before.status as string)
    .select(COLS);
  if (error) return NextResponse.json({ error: 'Failed to cancel leave' }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'This leave changed meanwhile — reload and try again' }, { status: 409 });
  }
  const data = rows[0];

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    before,
    after: data,
    reason: cancelReason ? `leave cancelled — ${cancelReason}` : 'leave cancelled',
  });

  // Best-effort from here: the cancel itself is committed. A failed revert is reported, not hidden.
  const revert = wasApproved
    ? await revertLeaveOverrides(
        service,
        {
          id,
          user_id: before.user_id as string,
          from_date: before.from_date as string,
          to_date: before.to_date as string,
        },
        auth.userId
      )
    : { revertedDays: 0, warnings: [] as string[] };

  if (wasApproved) {
    try {
      const from = before.from_date as string;
      const to = before.to_date as string;
      await notifyUser({
        userId: before.user_id as string,
        storeId: (before.store_id as string | null) ?? null,
        type: 'hr_leave_result',
        title: 'การลาถูกยกเลิก',
        body: `ยกเลิกการลา ${from === to ? from : `${from} – ${to}`}${cancelReason ? ` — ${cancelReason}` : ''}`,
        data: { url: '/me/leaves' },
      });
    } catch (e) {
      console.error('[leaves/cancel] notify employee failed:', e);
    }
  }

  return NextResponse.json({
    data: { ...data, reverted_days: revert.revertedDays },
    ...(revert.warnings.length ? { warning: revert.warnings.join('; ') } : {}),
  });
}
