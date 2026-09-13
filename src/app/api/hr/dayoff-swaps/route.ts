import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { buildEmployeeNameMap } from '@/lib/hr/employee-name-map';
import { planDayoffSwap, swapCellsFrom } from '@/lib/hr/dayoff-swap';

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

interface SwapRow {
  id: string;
  requester_id: string;
  requester_date: string;
  counterpart_id: string;
  counterpart_date: string;
  status: string;
  note: string | null;
  decided_at: string | null;
  hr_acked_at: string | null;
}
interface CellRow {
  user_id: string;
  work_date: string;
  store_id: string | null;
  is_day_off: boolean;
}

// GET /api/hr/dayoff-swaps?store_id&status? — a store's day-off swaps for the approver queue (§C,
// P2.3a). For each pending swap it says what approving would do on TODAY's roster, by the same rule
// the approval RPC applies (src/lib/hr/dayoff-swap.ts) — or why approving is no longer possible —
// so the approver sees the outcome before pressing the button.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeId = sp.get('store_id') ?? '';
  // A day-off swap is a roster change, so it belongs to whoever builds the roster — the captain
  // as much as the manager (client request 2026-08-14).
  const auth = await requireStoreManager(storeId, 'schedule');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const status = sp.get('status');
  if (status && !STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const service = createServiceClient();
  let query = service
    .from('hr_dayoff_swaps')
    .select(
      'id, requester_id, requester_date, counterpart_id, counterpart_date, status, note, decided_at, hr_acked_at'
    )
    .eq('store_id', storeId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load swaps' }, { status: 500 });

  const swaps = (data ?? []) as SwapRow[];
  const pending = swaps.filter((s) => s.status === 'pending');
  const userIds = [...new Set(swaps.flatMap((s) => [s.requester_id, s.counterpart_id]))];
  const pendingUserIds = [...new Set(pending.flatMap((s) => [s.requester_id, s.counterpart_id]))];
  const pendingDates = [...new Set(pending.flatMap((s) => [s.requester_date, s.counterpart_date]))];

  const [nameById, cellsRes] = await Promise.all([
    // ชื่อจริง (ชื่อเล่น), same rule as /hr/payroll — a swap names two people, both of them the
    // way their payslip does.
    buildEmployeeNameMap(service, userIds),
    pendingUserIds.length
      ? service
          .from('hr_schedule')
          .select('user_id, work_date, store_id, is_day_off')
          .in('user_id', pendingUserIds)
          .in('work_date', pendingDates)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (cellsRes.error) {
    return NextResponse.json({ error: 'Failed to load swaps' }, { status: 500 });
  }
  const cells = (cellsRes.data ?? []) as CellRow[];

  const out = swaps.map((s) => {
    // A decided swap has already happened (or never will) — only a pending one has an outcome to show.
    const plan =
      s.status === 'pending'
        ? planDayoffSwap(s.requester_date, s.counterpart_date, storeId, swapCellsFrom(cells, s))
        : null;
    return {
      id: s.id,
      requester_name: nameById.get(s.requester_id)?.name ?? null,
      requester_nickname: nameById.get(s.requester_id)?.nickname ?? null,
      counterpart_name: nameById.get(s.counterpart_id)?.name ?? null,
      counterpart_nickname: nameById.get(s.counterpart_id)?.nickname ?? null,
      requester_date: s.requester_date,
      counterpart_date: s.counterpart_date,
      same_day: s.requester_date === s.counterpart_date,
      status: s.status,
      note: s.note,
      decided_at: s.decided_at,
      hr_acked_at: s.hr_acked_at,
      preview:
        plan === null
          ? null
          : plan.ok
            ? { ok: true, counterpart_trades: plan.kind === 'own_days' && plan.counterpartTrades }
            : { ok: false, reason: plan.reason },
    };
  });

  return NextResponse.json({ data: out });
}
