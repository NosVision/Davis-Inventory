import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyHrManagers } from '@/lib/hr/notify';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_OPEN_SWAPS = 20;

// A real calendar date, not just the shape — rejects '2026-02-30' before it reaches
// the DB (which would otherwise 500 on a date-out-of-range cast).
function isCalendarDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
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
// Auth-any: the caller is always the requester. We derive the store from the
// caller's own schedule cell so a swap can only ever be filed within one store,
// and confirm the counterpart is genuinely scheduled there on the target date.
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

  // The requester must be scheduled on requester_date — that row fixes the store.
  const { data: mine, error: mineErr } = await service
    .from('hr_schedule')
    .select('store_id')
    .eq('user_id', user.id)
    .eq('work_date', requesterDate)
    .maybeSingle();
  if (mineErr) return NextResponse.json({ error: 'Failed to verify schedule' }, { status: 500 });
  if (!mine) {
    return NextResponse.json({ error: 'you are not scheduled on that date' }, { status: 400 });
  }
  const storeId = mine.store_id as string;

  // The counterpart must be scheduled on counterpart_date at the SAME store.
  const { data: theirs, error: theirsErr } = await service
    .from('hr_schedule')
    .select('store_id')
    .eq('user_id', counterpartId)
    .eq('work_date', counterpartDate)
    .maybeSingle();
  if (theirsErr) return NextResponse.json({ error: 'Failed to verify schedule' }, { status: 500 });
  if (!theirs || (theirs.store_id as string) !== storeId) {
    return NextResponse.json(
      { error: 'coworker is not scheduled on that date at your store' },
      { status: 400 }
    );
  }

  // And the counterpart must belong to that store.
  const { data: member, error: memberErr } = await service
    .from('user_stores')
    .select('user_id')
    .eq('store_id', storeId)
    .eq('user_id', counterpartId)
    .maybeSingle();
  if (memberErr) return NextResponse.json({ error: 'Failed to verify coworker' }, { status: 500 });
  if (!member) {
    return NextResponse.json({ error: 'coworker is not assigned to your store' }, { status: 400 });
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
    return NextResponse.json({ error: 'Too many open swap requests' }, { status: 429 });
  }
  if (
    open.some(
      (p) =>
        p.requester_date === requesterDate &&
        p.counterpart_id === counterpartId &&
        p.counterpart_date === counterpartDate
    )
  ) {
    return NextResponse.json({ error: 'You already have a pending swap for this' }, { status: 409 });
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
      return NextResponse.json({ error: 'You already have a pending swap for this' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to file swap' }, { status: 500 });
  }

  // Notify HR that a swap awaits approval (§Q5 flow: file → notify HR → HR approves).
  // Best-effort — a notification failure must never fail the filing itself.
  try {
    const { data: names } = await service
      .from('profiles')
      .select('id, display_name, username')
      .in('id', [user.id, counterpartId]);
    const nameOf = (id: string) => {
      const p = (names ?? []).find((x) => x.id === id);
      return p?.display_name || p?.username || '—';
    };
    await notifyHrManagers(service, {
      storeId,
      type: 'hr_swap_request',
      title: 'คำขอสลับวันหยุดใหม่',
      body: `${nameOf(user.id)} ขอสลับวันหยุด ${requesterDate} ↔ ${nameOf(counterpartId)} (${counterpartDate}) — รออนุมัติ`,
      data: { swap_id: data.id, url: '/hr/swaps' },
      excludeUserId: user.id,
    });
  } catch (e) {
    console.error('[hr/ess/dayoff-swaps] notify HR failed:', e);
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
