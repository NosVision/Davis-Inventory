import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyUser } from '@/lib/notifications/service';
import { notifyHrManagers } from '@/lib/hr/notify';
import { isDateInFinalizedPeriod, FINALIZED_PERIOD_ERROR } from '@/lib/hr/period-lock';
import { planDayoffSwap, swapCellsFrom, type SwapBlockReason } from '@/lib/hr/dayoff-swap';

// Said to the approver: the roster moved since the request was filed, so approving would no longer do
// what the employee asked. The way out is to reject it and have them file again.
const BLOCK_MESSAGE: Record<SwapBlockReason, string> = {
  requester_missing: 'อนุมัติไม่ได้ — ผู้ขอไม่มีตารางงานครบทั้งสองวันในสาขานี้แล้ว ให้ปฏิเสธแล้วให้ยื่นใหม่',
  counterpart_missing: 'อนุมัติไม่ได้ — เพื่อนร่วมงานไม่มีตารางงานครบทั้งสองวันในสาขานี้แล้ว ให้ปฏิเสธแล้วให้ยื่นใหม่',
  requester_not_off: 'อนุมัติไม่ได้ — ตารางเปลี่ยนแล้ว ผู้ขอไม่ได้หยุดในวันหยุดเดิมที่ขอ ให้ปฏิเสธแล้วให้ยื่นใหม่',
  requester_already_off: 'อนุมัติไม่ได้ — ตารางเปลี่ยนแล้ว ผู้ขอหยุดอยู่แล้วในวันที่ขอหยุดแทน ให้ปฏิเสธแล้วให้ยื่นใหม่',
};

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' */
function dmy(d: string): string {
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}

// POST /api/hr/dayoff-swaps/[id]/decide — the store's roster owner (its manager or captain, via
// requireStoreManager 'schedule') approves or rejects a pending swap. Company HR passes the same gate
// and decides only as the fallback for a store with nobody set up; HR's own step is acknowledging
// afterwards (…/ack) — client decision 2026-07-20, owner 2026-09-13.
//
// Approval is the atomic RPC hr_approve_dayoff_swap (00202), which applies the rule in
// src/lib/hr/dayoff-swap.ts. The same rule is checked here first against today's roster, so a
// roster that moved since filing is refused with a reason rather than a bare 409. Every decision is
// written to hr_audit_log and both employees are told the outcome (best-effort).
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

  // Deciding a swap rewrites roster days — roster authority, not approval authority.
  const auth = await requireStoreManager(swap.store_id as string, 'schedule');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const requesterId = swap.requester_id as string;
  const counterpartId = swap.counterpart_id as string;
  const requesterDate = swap.requester_date as string;
  const counterpartDate = swap.counterpart_date as string;

  // Nobody signs off a swap they are part of. Company HR is exempt: they can edit any roster anyway,
  // and are the fallback when there is no one else.
  if (!auth.fullHr && (auth.userId === requesterId || auth.userId === counterpartId)) {
    return NextResponse.json(
      { error: 'อนุมัติหรือปฏิเสธคำขอที่ตัวเองเกี่ยวข้องไม่ได้ — ต้องให้หัวหน้าคนอื่นหรือ HR เป็นผู้ทำ' },
      { status: 403 }
    );
  }

  if ((swap.status as string) !== 'pending') {
    return NextResponse.json({ error: 'Only pending swaps can be decided' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  const { data: people } = await service
    .from('profiles')
    .select('id, display_name, username')
    .in('id', [requesterId, counterpartId]);
  const nameOf = (userId: string) => {
    const p = (people ?? []).find((x) => x.id === userId);
    return (p?.display_name as string | null) || (p?.username as string | null) || '—';
  };
  const sameDay = requesterDate === counterpartDate;
  const what = sameDay
    ? `แลกกะวันที่ ${dmy(requesterDate)}`
    : `ย้ายวันหยุด ${dmy(requesterDate)} → ${dmy(counterpartDate)}`;

  // Both employees learn the outcome; the new roster is visible on /me/schedule.
  const notifyBoth = async (approved: boolean) => {
    const title = approved ? 'สลับวันหยุดได้รับอนุมัติ' : 'คำขอสลับวันหยุดไม่ได้รับอนุมัติ';
    const bodyText = approved
      ? `${nameOf(requesterId)} ${what} — ตารางงานอัปเดตแล้ว`
      : `คำขอ${what}ของ ${nameOf(requesterId)} ถูกปฏิเสธ${note ? ` — ${note}` : ''}`;
    await Promise.allSettled(
      [requesterId, counterpartId].map((userId) =>
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
    // §Phase 0B: the swap changes paid work-day counts. Refuse if EITHER date's pay period is
    // finalized (both employees share this store). Reject stays allowed.
    try {
      const storeIds = [swap.store_id as string];
      const [reqLocked, cpLocked] = await Promise.all([
        isDateInFinalizedPeriod(service, requesterDate, storeIds),
        isDateInFinalizedPeriod(service, counterpartDate, storeIds),
      ]);
      if (reqLocked || cpLocked) {
        return NextResponse.json({ error: FINALIZED_PERIOD_ERROR }, { status: 409 });
      }
    } catch {
      return NextResponse.json({ error: 'Failed to verify pay period' }, { status: 500 });
    }

    // Today's roster, checked by the same rule the RPC applies.
    const { data: cellRows, error: cellErr } = await service
      .from('hr_schedule')
      .select('user_id, work_date, store_id, is_day_off')
      .in('user_id', [requesterId, counterpartId])
      .in('work_date', [requesterDate, counterpartDate]);
    if (cellErr) return NextResponse.json({ error: 'Failed to verify schedule' }, { status: 500 });
    const plan = planDayoffSwap(
      requesterDate,
      counterpartDate,
      swap.store_id as string,
      swapCellsFrom(
        (cellRows ?? []) as { user_id: string; work_date: string; store_id: string | null; is_day_off: boolean }[],
        { requester_id: requesterId, requester_date: requesterDate, counterpart_id: counterpartId, counterpart_date: counterpartDate }
      )
    );
    if (!plan.ok) return NextResponse.json({ error: BLOCK_MESSAGE[plan.reason] }, { status: 409 });

    const { error: rpcErr } = await service.rpc('hr_approve_dayoff_swap', {
      p_swap_id: id,
      p_approver: auth.userId,
    });
    // The roster changed between the check above and the RPC's own locked re-check.
    if (rpcErr) {
      return NextResponse.json(
        { error: 'สลับตารางไม่ได้ — ตารางงานของสองวันนี้เพิ่งเปลี่ยน ให้โหลดหน้าใหม่แล้วลองอีกครั้ง' },
        { status: 409 }
      );
    }

    // HR deciding as the fallback has nothing left to acknowledge.
    if (auth.fullHr) {
      const { error: ackErr } = await service
        .from('hr_dayoff_swaps')
        .update({ hr_acked_by: auth.userId, hr_acked_at: new Date().toISOString() })
        .eq('id', id);
      if (ackErr) console.error('[dayoff-swaps/decide] self-ack failed:', ackErr.message);
    }

    // §B audit: the decision AND the roster change it performed, in one record.
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
          kind: plan.kind,
          counterpart_trades: plan.kind === 'own_days' ? plan.counterpartTrades : true,
          requester_id: requesterId,
          requester_date: requesterDate,
          counterpart_id: counterpartId,
          counterpart_date: counterpartDate,
        },
      },
      reason: note ?? 'Day-off swap approved — roster updated',
    });
    try {
      await notifyBoth(true);
      if (!auth.fullHr) {
        await notifyHrManagers(service, {
          storeId: swap.store_id as string,
          type: 'hr_swap_approved',
          title: 'สาขาอนุมัติสลับวันหยุดแล้ว — รอ HR รับทราบ',
          body: `${nameOf(requesterId)} ${what} (สลับกับ ${nameOf(counterpartId)})`,
          data: { swap_id: id, url: '/hr/swaps' },
          excludeUserId: auth.userId,
        });
      }
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
