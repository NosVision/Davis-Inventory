import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyUser } from '@/lib/notifications/service';
import { isDateInFinalizedPeriod, FINALIZED_PERIOD_ERROR } from '@/lib/hr/period-lock';

// POST /api/hr/dayoff-swaps/[id]/decide — HR (or the store's manager) approves or rejects a
// pending swap (§C, P2.3a; flow re-confirmed by the owner 2026-07-05: staff file → HR notified →
// HR approves → both schedules exchange immediately + audit). Approval is delegated to the atomic
// RPC hr_approve_dayoff_swap, which re-checks the swap is pending and exchanges the two schedule
// cells transactionally; any stale/precondition failure surfaces as a generic 409 (never the raw
// Postgres RAISE text). Every decision is written to hr_audit_log, and both employees are
// notified of the outcome (best-effort — a notify failure never fails the decision).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: swap, error: loadErr } = await service
    .from('hr_dayoff_swaps')
    .select('id, store_id, status, requester_id, requester_date, counterpart_id, counterpart_date')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load swap' }, { status: 500 });
  if (!swap) return NextResponse.json({ error: 'Swap not found' }, { status: 404 });

  const auth = await requireStoreManager(swap.store_id as string);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if ((swap.status as string) !== 'pending') {
    return NextResponse.json({ error: 'Only pending swaps can be decided' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  // Both employees learn the outcome; the schedule swap is visible on /me/schedule.
  const notifyBoth = async (approved: boolean) => {
    const title = approved ? 'สลับวันหยุดได้รับอนุมัติ' : 'คำขอสลับวันหยุดไม่ได้รับอนุมัติ';
    const bodyText = approved
      ? `ตารางถูกสลับแล้ว: ${swap.requester_date} ↔ ${swap.counterpart_date}`
      : `คำขอสลับ ${swap.requester_date} ↔ ${swap.counterpart_date} ถูกปฏิเสธ${note ? ` — ${note}` : ''}`;
    await Promise.allSettled(
      [swap.requester_id as string, swap.counterpart_id as string].map((userId) =>
        notifyUser({
          userId,
          storeId: swap.store_id as string,
          type: 'hr_swap_result',
          title,
          body: bodyText,
          data: { swap_id: id, url: '/me/swaps' },
        })
      )
    );
  };

  if (decision === 'approved') {
    // §Phase 0B: the swap exchanges two schedule cells (is_day_off), changing paid work-day counts.
    // Refuse if EITHER date's pay period is finalized (both employees share this store). Reject stays allowed.
    try {
      const storeIds = [swap.store_id as string];
      const [reqLocked, cpLocked] = await Promise.all([
        isDateInFinalizedPeriod(service, swap.requester_date as string, storeIds),
        isDateInFinalizedPeriod(service, swap.counterpart_date as string, storeIds),
      ]);
      if (reqLocked || cpLocked) {
        return NextResponse.json({ error: FINALIZED_PERIOD_ERROR }, { status: 409 });
      }
    } catch {
      return NextResponse.json({ error: 'Failed to verify pay period' }, { status: 500 });
    }

    const { error: rpcErr } = await service.rpc('hr_approve_dayoff_swap', {
      p_swap_id: id,
      p_approver: auth.userId,
    });
    // The RPC raises on any stale/missing schedule precondition — surface generically.
    if (rpcErr) return NextResponse.json({ error: 'Could not apply swap' }, { status: 409 });

    // §B audit: the decision AND the schedule exchange it performed, in one record.
    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: 'hr_dayoff_swaps',
      recordId: id,
      before: { status: 'pending' },
      after: {
        status: 'approved',
        decided_by: auth.userId,
        schedule_swapped: {
          requester_id: swap.requester_id,
          requester_date: swap.requester_date,
          counterpart_id: swap.counterpart_id,
          counterpart_date: swap.counterpart_date,
        },
      },
      reason: note ?? 'Day-off swap approved — schedules exchanged',
    });
    try {
      await notifyBoth(true);
    } catch (e) {
      console.error('[dayoff-swaps/decide] notify failed:', e);
    }
    return NextResponse.json({ data: { id, status: 'approved' } });
  }

  if (decision === 'rejected') {
    // Atomic compare-and-set (only a still-pending row), so a reject racing a concurrent
    // approve can't overwrite the already-applied 'approved' row and orphan the swap.
    const { data: updated, error } = await service
      .from('hr_dayoff_swaps')
      .update({
        status: 'rejected',
        decided_by: auth.userId,
        decided_at: new Date().toISOString(),
        decision_note: note,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) return NextResponse.json({ error: 'Failed to reject swap' }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Swap was already decided' }, { status: 409 });
    }

    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: 'hr_dayoff_swaps',
      recordId: id,
      before: { status: 'pending' },
      after: { status: 'rejected', decided_by: auth.userId, decision_note: note },
      reason: note ?? 'Day-off swap rejected',
    });
    try {
      await notifyBoth(false);
    } catch (e) {
      console.error('[dayoff-swaps/decide] notify failed:', e);
    }
    return NextResponse.json({ data: { id, status: 'rejected' } });
  }

  return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
}
