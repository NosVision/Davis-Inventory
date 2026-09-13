import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyStoreSchedulers } from '@/lib/hr/notify';
import { planDayoffSwap, swapCellsFrom, type SwapBlockReason } from '@/lib/hr/dayoff-swap';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_OPEN_SWAPS = 20;

// Said to the requester, who can fix each of these before filing again.
const BLOCK_MESSAGE: Record<SwapBlockReason, string> = {
  requester_missing: 'คุณยังไม่มีตารางงานครบทั้งสองวันที่เลือก (ต้องเป็นสาขาเดียวกัน)',
  counterpart_missing: 'เพื่อนร่วมงานยังไม่มีตารางงานครบทั้งสองวันนี้ที่สาขาของคุณ',
  requester_not_off: 'วันหยุดเดิมที่เลือก ในตารางงานคุณไม่ได้หยุดวันนั้น',
  requester_already_off: 'วันที่อยากหยุดแทน ในตารางงานคุณหยุดวันนั้นอยู่แล้ว',
};

// A real calendar date, not just the shape — rejects '2026-02-30' before it reaches
// the DB (which would otherwise 500 on a date-out-of-range cast).
function isCalendarDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' */
function dmy(d: string): string {
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
}

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
}
interface SwapRow {
  id: string;
  store_id: string;
  requester_id: string;
  requester_date: string;
  counterpart_id: string;
  counterpart_date: string;
  status: string;
  note: string | null;
  created_at: string;
}
interface CellRow {
  user_id: string;
  work_date: string;
  store_id: string | null;
  is_day_off: boolean;
}

type ServiceClient = ReturnType<typeof createServiceClient>;

// Map involved profile ids → display name (display_name || username).
async function loadNames(
  service: ServiceClient,
  ids: string[]
): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await service
    .from('profiles')
    .select('id, username, display_name')
    .in('id', ids);
  const map = new Map<string, string>();
  for (const p of (data ?? []) as ProfileRow[]) {
    map.set(p.id, p.display_name || p.username || '—');
  }
  return map;
}

// POST /api/hr/ess/dayoff-swaps — a requester files a day-off swap (§C, P2.3a).
// Auth-any: the caller is always the requester. `requester_date` is their current day off and
// `counterpart_date` the day they want off instead (or the same day, for a shift trade). The request
// is checked against today's roster with the same rule approval applies (src/lib/hr/dayoff-swap.ts),
// so what gets filed is something an approval can actually carry out.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const counterpartId = typeof body.counterpart_id === 'string' ? body.counterpart_id : '';
  const requesterDate = typeof body.requester_date === 'string' ? body.requester_date : '';
  const counterpartDate = typeof body.counterpart_date === 'string' ? body.counterpart_date : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  if (!isCalendarDate(requesterDate) || !isCalendarDate(counterpartDate)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }
  if (!counterpartId || counterpartId === user.id) {
    return NextResponse.json({ error: 'Invalid counterpart' }, { status: 400 });
  }

  const service = createServiceClient();

  // Every roster row the swap touches: both people, both days.
  const { data: cellRows, error: cellErr } = await service
    .from('hr_schedule')
    .select('user_id, work_date, store_id, is_day_off')
    .in('user_id', [user.id, counterpartId])
    .in('work_date', [requesterDate, counterpartDate]);
  if (cellErr) return NextResponse.json({ error: 'Failed to verify schedule' }, { status: 500 });
  const rows = (cellRows ?? []) as CellRow[];

  // The requester's row on their current day off fixes the store — a swap never crosses stores.
  const storeId =
    rows.find((r) => r.user_id === user.id && r.work_date === requesterDate)?.store_id ?? null;
  if (!storeId) {
    return NextResponse.json(
      { error: 'คุณยังไม่มีตารางงานของสาขาในวันหยุดเดิมที่เลือก' },
      { status: 400 }
    );
  }

  const plan = planDayoffSwap(
    requesterDate,
    counterpartDate,
    storeId,
    swapCellsFrom(rows, {
      requester_id: user.id,
      requester_date: requesterDate,
      counterpart_id: counterpartId,
      counterpart_date: counterpartDate,
    })
  );
  if (!plan.ok) return NextResponse.json({ error: BLOCK_MESSAGE[plan.reason] }, { status: 400 });

  // And the counterpart must belong to that store.
  const { data: member, error: memberErr } = await service
    .from('user_stores')
    .select('user_id')
    .eq('store_id', storeId)
    .eq('user_id', counterpartId)
    .maybeSingle();
  if (memberErr) return NextResponse.json({ error: 'Failed to verify coworker' }, { status: 500 });
  if (!member) {
    return NextResponse.json({ error: 'เพื่อนร่วมงานไม่ได้อยู่สาขาเดียวกับคุณ' }, { status: 400 });
  }

  // Abuse / duplicate guard: cap open requests, and reject an identical still-pending
  // swap. The DB partial-unique index (hr_dayoff_swaps_one_open) is the race-proof
  // backstop; this gives a clean 409/429 without a stray insert.
  const { data: pendings } = await service
    .from('hr_dayoff_swaps')
    .select('requester_date, counterpart_id, counterpart_date')
    .eq('requester_id', user.id)
    .eq('status', 'pending');
  const open = pendings ?? [];
  if (open.length >= MAX_OPEN_SWAPS) {
    return NextResponse.json({ error: 'มีคำขอค้างอยู่มากเกินไป' }, { status: 429 });
  }
  if (
    open.some(
      (p) =>
        p.requester_date === requesterDate &&
        p.counterpart_id === counterpartId &&
        p.counterpart_date === counterpartDate
    )
  ) {
    return NextResponse.json({ error: 'มีคำขอแบบนี้รออนุมัติอยู่แล้ว' }, { status: 409 });
  }

  const { data, error } = await service
    .from('hr_dayoff_swaps')
    .insert({
      store_id: storeId,
      requester_id: user.id,
      requester_date: requesterDate,
      counterpart_id: counterpartId,
      counterpart_date: counterpartDate,
      note,
      status: 'pending',
    })
    .select(
      'id, store_id, requester_id, requester_date, counterpart_id, counterpart_date, status, note, created_at'
    )
    .single();
  if (error) {
    // 23505 = the partial-unique index caught a concurrent duplicate.
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'มีคำขอแบบนี้รออนุมัติอยู่แล้ว' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to file swap' }, { status: 500 });
  }

  // The store's roster owners decide (its manager or captain); HR only acknowledges afterwards, and
  // hears about the request itself only when the store has nobody else to decide it.
  // Best-effort — a notification failure must never fail the filing itself.
  try {
    const names = await loadNames(service, [user.id, counterpartId]);
    const me = names.get(user.id) ?? '—';
    const them = names.get(counterpartId) ?? '—';
    const summary =
      plan.kind === 'same_day'
        ? `${me} ขอแลกกะกับ ${them} วันที่ ${dmy(requesterDate)}`
        : `${me} ขอย้ายวันหยุด ${dmy(requesterDate)} → ${dmy(counterpartDate)} (สลับกับ ${them})`;
    await notifyStoreSchedulers(service, {
      storeId,
      type: 'hr_swap_request',
      title: 'คำขอสลับวันหยุดใหม่',
      body: `${summary} — รออนุมัติ`,
      data: { swap_id: data.id },
      storeUrl: '/schedule/swaps',
      hrUrl: '/hr/swaps',
      excludeUserIds: [user.id, counterpartId],
    });
  } catch (e) {
    console.error('[hr/ess/dayoff-swaps] notify approvers failed:', e);
  }

  return NextResponse.json({ data }, { status: 201 });
}

// GET /api/hr/ess/dayoff-swaps — the caller's own swaps (as requester OR counterpart).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_dayoff_swaps')
    .select(
      'id, store_id, requester_id, requester_date, counterpart_id, counterpart_date, status, note, created_at'
    )
    .or(`requester_id.eq.${user.id},counterpart_id.eq.${user.id}`)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load swaps' }, { status: 500 });

  const swaps = (data ?? []) as SwapRow[];
  const names = await loadNames(
    service,
    [...new Set(swaps.flatMap((s) => [s.requester_id, s.counterpart_id]))]
  );

  const out = swaps.map((s) => ({
    id: s.id,
    role: s.requester_id === user.id ? 'requester' : 'counterpart',
    store_id: s.store_id,
    requester_name: names.get(s.requester_id) ?? null,
    counterpart_name: names.get(s.counterpart_id) ?? null,
    requester_date: s.requester_date,
    counterpart_date: s.counterpart_date,
    status: s.status,
    note: s.note,
    created_at: s.created_at,
  }));

  return NextResponse.json({ data: out });
}
