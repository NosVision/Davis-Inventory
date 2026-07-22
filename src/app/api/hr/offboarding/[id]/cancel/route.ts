import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForRowStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_offboarding';

// POST /api/hr/offboarding/[id]/cancel — abandon an offboarding. Two paths, both atomic
// compare-and-sets so a concurrent complete/cancel can never double-run:
//   • open (draft|pending_signoff) → cancelled, nothing else to undo.
//   • completed → cancelled + best-effort REVERT of the completion's downstream effects:
//     hr_employees back to active (end_date/end_reason cleared) and the account
//     reactivated. Asset changes are NOT auto-reverted — the asset may have been
//     reassigned since — so the response warns HR to review them on the assets page.
// Already cancelled → 409.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireHrManagerForRowStore('hr_offboarding', id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(TABLE)
    .select('id, status, user_id')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load offboarding' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Offboarding not found' }, { status: 404 });

  const status = row.status as string;
  const userId = row.user_id as string;

  // Open record: plain cancel, no downstream effects to undo.
  if (status === 'draft' || status === 'pending_signoff') {
    const { data: updated, error } = await service
      .from(TABLE)
      .update({ status: 'cancelled', updated_by: auth.userId })
      .eq('id', id)
      .in('status', ['draft', 'pending_signoff'])
      .select('id');
    if (error) return NextResponse.json({ error: 'Failed to cancel offboarding' }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: 'This offboarding changed state; reload and try again' },
        { status: 409 }
      );
    }

    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: TABLE,
      recordId: id,
      after: { status: 'cancelled' },
      reason: 'Offboarding cancelled',
    });

    return NextResponse.json({ data: { id, status: 'cancelled' } });
  }

  if (status !== 'completed') {
    return NextResponse.json({ error: 'This offboarding is already cancelled' }, { status: 409 });
  }

  // Completed record: claim the cancellation atomically FIRST, then revert best-effort.
  const { data: reverted, error: revertErr } = await service
    .from(TABLE)
    .update({ status: 'cancelled', completed_at: null, updated_by: auth.userId })
    .eq('id', id)
    .eq('status', 'completed')
    .select('id');
  if (revertErr) return NextResponse.json({ error: 'Failed to cancel offboarding' }, { status: 500 });
  if (!reverted || reverted.length === 0) {
    return NextResponse.json(
      { error: 'This offboarding changed state; reload and try again' },
      { status: 409 }
    );
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    before: { status: 'completed' },
    after: { status: 'cancelled', completed_at: null },
    reason: 'Completed offboarding cancelled (reverted)',
  });

  const warnings: string[] = [];

  // hr_employees: restore the person to active. `probation` before offboarding is not
  // recoverable here — HR can adjust it on the employee page if needed.
  const { data: empBefore, error: empReadErr } = await service
    .from('hr_employees')
    .select('id, status, end_date, end_reason')
    .eq('profile_id', userId)
    .maybeSingle();
  if (empReadErr || !empBefore) {
    warnings.push('Could not restore the employee record (hr_employees).');
  } else {
    const { error: empUpdErr } = await service
      .from('hr_employees')
      .update({ status: 'active', end_date: null, end_reason: null })
      .eq('profile_id', userId);
    if (empUpdErr) {
      warnings.push('Failed to restore the employee record (hr_employees).');
    } else {
      await logHrAudit(service, {
        actorId: auth.userId,
        action: 'update',
        table: 'hr_employees',
        recordId: empBefore.id as string,
        before: {
          status: empBefore.status,
          end_date: empBefore.end_date,
          end_reason: empBefore.end_reason,
        },
        after: { status: 'active', end_date: null, end_reason: null },
        reason: 'Offboarding cancelled: employee restored',
      });
    }
  }

  // Reactivate the account.
  const { error: profErr } = await service.from('profiles').update({ active: true }).eq('id', userId);
  if (profErr) {
    warnings.push('Failed to reactivate the employee account.');
  } else {
    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: 'profiles',
      recordId: userId,
      before: { active: false },
      after: { active: true },
      reason: 'Offboarding cancelled: account reactivated',
    });
  }

  warnings.push(
    'Asset statuses from this offboarding were NOT reverted automatically — review them on the assets page.'
  );

  return NextResponse.json({
    data: { id, status: 'cancelled' },
    warning: warnings.join('; '),
  });
}
