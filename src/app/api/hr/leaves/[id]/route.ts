import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForEmployeeProfile } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_leaves';
const COLS =
  'id, user_id, store_id, company_id, leave_type_id, from_date, to_date, days, reason, status, approver_id, decided_at, decision_note';

// DELETE /api/hr/leaves/[id] — HR removes a leave by soft-cancelling it (status='cancelled').
// Used from the timesheet day-edit modal when HR reclassifies a day away from "leave" (owner
// ask 2026-07-10). A cancelled leave no longer covers the day in payroll (which only counts
// approved leaves) nor shows on the timesheet. The row is kept for the audit trail, not hard-
// deleted. §P5.5: company-wide HR, or a manager whose stores include this employee.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  const { data, error } = await service
    .from(TABLE)
    .update({ status: 'cancelled', decided_at: new Date().toISOString(), approver_id: auth.userId })
    .eq('id', id)
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    before,
    after: data,
    reason: 'leave cancelled from timesheet',
  });

  return NextResponse.json({ data });
}
