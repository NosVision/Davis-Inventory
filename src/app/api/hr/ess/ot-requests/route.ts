import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_OPEN_OT_REQUESTS = 20;
const MAX_OT_MIN = 1440; // one full day, in minutes

const COLS =
  'id, user_id, store_id, work_date, requested_ot_min, reason, status, decided_by, decided_at, decision_note, decided_ot_min, created_at';

// A real calendar date, not just the shape — rejects '2026-02-30' before it reaches
// the DB (which would otherwise 500 on a date-out-of-range cast).
function isCalendarDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

interface OtRequestRow {
  id: string;
  user_id: string;
  store_id: string;
  work_date: string;
  requested_ot_min: number;
  reason: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  decided_ot_min: number | null;
  created_at: string;
}

// POST /api/hr/ess/ot-requests — an employee files an overtime request for a shift
// (§B/§J8). Auth-any: the caller is always the requester. We derive the store from
// the caller's OWN schedule cell for that date — never from a client-supplied
// store_id — so a request can only ever be filed against a store the caller is
// actually scheduled at.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const workDate = typeof body.work_date === 'string' ? body.work_date : '';
  const requestedOtMin =
    typeof body.requested_ot_min === 'number' ? body.requested_ot_min : NaN;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!isCalendarDate(workDate)) {
    return NextResponse.json({ error: 'Invalid work_date' }, { status: 400 });
  }
  if (
    !Number.isInteger(requestedOtMin) ||
    requestedOtMin <= 0 ||
    requestedOtMin > MAX_OT_MIN
  ) {
    return NextResponse.json(
      { error: `requested_ot_min must be a positive integer up to ${MAX_OT_MIN}` },
      { status: 400 }
    );
  }
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
  }

  const service = createServiceClient();

  // The requester must be scheduled on work_date — that row fixes the store.
  const { data: mine, error: mineErr } = await service
    .from('hr_schedule')
    .select('store_id')
    .eq('user_id', user.id)
    .eq('work_date', workDate)
    .maybeSingle();
  if (mineErr) return NextResponse.json({ error: 'Failed to verify schedule' }, { status: 500 });
  if (!mine) {
    return NextResponse.json({ error: 'you are not scheduled on that date' }, { status: 400 });
  }
  const storeId = mine.store_id as string;

  // Abuse / duplicate guard: cap open requests, and reject a duplicate still-pending
  // request for the same date. The DB partial-unique index is the race-proof
  // backstop; this gives a clean 409/429 without a stray insert.
  const { data: pendings } = await service
    .from('hr_ot_requests')
    .select('work_date')
    .eq('user_id', user.id)
    .eq('status', 'pending');
  const open = pendings ?? [];
  if (open.length >= MAX_OPEN_OT_REQUESTS) {
    return NextResponse.json({ error: 'Too many open OT requests' }, { status: 429 });
  }
  if (open.some((p) => p.work_date === workDate)) {
    return NextResponse.json(
      { error: 'You already have a pending OT request for this date' },
      { status: 409 }
    );
  }

  const { data, error } = await service
    .from('hr_ot_requests')
    .insert({
      user_id: user.id,
      store_id: storeId,
      work_date: workDate,
      requested_ot_min: requestedOtMin,
      reason,
      status: 'pending',
    })
    .select(COLS)
    .single();
  if (error) {
    // 23505 = the partial-unique index caught a concurrent duplicate.
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'You already have a pending OT request for this date' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Failed to file OT request' }, { status: 500 });
  }
  return NextResponse.json({ data }, { status: 201 });
}

// GET /api/hr/ess/ot-requests — the caller's own OT requests.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_ot_requests')
    .select(COLS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load OT requests' }, { status: 500 });

  const rows = (data ?? []) as OtRequestRow[];
  return NextResponse.json({ data: rows });
}
