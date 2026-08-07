import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { buildEmployeeNameMap } from '@/lib/hr/employee-name-map';

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
  is_day_off: boolean;
  shift: { label: string | null } | null;
}

// Current roster label for a (user, date) cell: the shift template label, 'day_off',
// or null when there is no schedule row — so the approver sees what they're trading.
function assignmentOf(cell: CellRow | undefined): string | null {
  if (!cell) return null;
  if (cell.is_day_off) return 'day_off';
  return cell.shift?.label ?? null;
}

// GET /api/hr/dayoff-swaps?store_id&status? — a store's day-off swaps for the
// approver queue (§C, P2.3a). Store-manager guarded. Shows both employees' CURRENT
// assignments so the manager knows exactly what an approval would exchange.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeId = sp.get('store_id') ?? '';
  const auth = await requireStoreManager(storeId);
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
  const userIds = [...new Set(swaps.flatMap((s) => [s.requester_id, s.counterpart_id]))];
  const dates = [...new Set(swaps.flatMap((s) => [s.requester_date, s.counterpart_date]))];

  const [nameById, cellsRes] = await Promise.all([
    // ชื่อจริง (ชื่อเล่น), same rule as /hr/payroll — a swap names two people, both of them the
    // way their payslip does.
    buildEmployeeNameMap(service, userIds),
    userIds.length
      ? service
          .from('hr_schedule')
          .select('user_id, work_date, is_day_off, shift:hr_shift_templates(label)')
          .in('user_id', userIds)
          .in('work_date', dates)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (cellsRes.error) {
    return NextResponse.json({ error: 'Failed to load swaps' }, { status: 500 });
  }

  const cellByKey = new Map<string, CellRow>();
  for (const c of (cellsRes.data ?? []) as unknown as CellRow[]) {
    cellByKey.set(`${c.user_id}|${c.work_date}`, c);
  }

  const out = swaps.map((s) => ({
    id: s.id,
    requester_name: nameById.get(s.requester_id)?.name ?? null,
    requester_nickname: nameById.get(s.requester_id)?.nickname ?? null,
    counterpart_name: nameById.get(s.counterpart_id)?.name ?? null,
    counterpart_nickname: nameById.get(s.counterpart_id)?.nickname ?? null,
    requester_date: s.requester_date,
    counterpart_date: s.counterpart_date,
    requester_assignment: assignmentOf(cellByKey.get(`${s.requester_id}|${s.requester_date}`)),
    counterpart_assignment: assignmentOf(
      cellByKey.get(`${s.counterpart_id}|${s.counterpart_date}`)
    ),
    status: s.status,
    note: s.note,
    decided_at: s.decided_at,
    hr_acked_at: s.hr_acked_at,
  }));

  return NextResponse.json({ data: out });
}
