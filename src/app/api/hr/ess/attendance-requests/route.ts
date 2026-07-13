import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { isDateInFinalizedPeriod, FINALIZED_PERIOD_ERROR } from '@/lib/hr/period-lock';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_OPEN_ATTENDANCE_REQUESTS = 20;
const KINDS = ['missing_in', 'missing_out', 'wrong_time', 'other'];
const PROPOSED_TYPES = ['in', 'out', 'break_start', 'break_end'];

const COLS =
  'id, user_id, store_id, business_date, kind, proposed_type, proposed_ts, target_attendance_id, reason, status, decided_by, decided_at, decision_note, applied, created_at';

// A real calendar date, not just the shape — rejects '2026-02-30' before it reaches
// the DB (which would otherwise 500 on a date-out-of-range cast).
function isCalendarDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

function isValidTimestamp(v: string | null): v is string {
  return typeof v === 'string' && v.length > 0 && !Number.isNaN(new Date(v).getTime());
}

interface AttendanceRequestRow {
  id: string;
  user_id: string;
  store_id: string;
  business_date: string;
  kind: string;
  proposed_type: string | null;
  proposed_ts: string | null;
  target_attendance_id: string | null;
  reason: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  applied: boolean;
  created_at: string;
}

// POST /api/hr/ess/attendance-requests — an employee files an attendance correction
// request (missing punch, wrong time, or other) (§B/§J8). Auth-any: the caller is
// always the requester. Per-kind validation mirrors the DB CHECK constraint exactly so
// bad input 400s here instead of surfacing as an opaque DB 500. store_id is NEVER
// trusted from the client — it is derived either from the target attendance row's own
// store (wrong_time) or from the caller's own schedule cell for that date (all other
// kinds).
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const businessDate = typeof body.business_date === 'string' ? body.business_date : '';
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const proposedType = typeof body.proposed_type === 'string' ? body.proposed_type : null;
  const proposedTs = typeof body.proposed_ts === 'string' ? body.proposed_ts : null;
  const targetAttendanceId =
    typeof body.target_attendance_id === 'string' ? body.target_attendance_id : null;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!isCalendarDate(businessDate)) {
    return NextResponse.json({ error: 'Invalid business_date' }, { status: 400 });
  }
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
  }

  const service = createServiceClient();
  let storeId: string | null = null;

  if (kind === 'missing_in' || kind === 'missing_out') {
    if (!proposedType || !PROPOSED_TYPES.includes(proposedType)) {
      return NextResponse.json(
        { error: 'proposed_type is required for a missing-punch request' },
        { status: 400 }
      );
    }
    if (!isValidTimestamp(proposedTs)) {
      return NextResponse.json(
        { error: 'A valid proposed_ts is required for a missing-punch request' },
        { status: 400 }
      );
    }
  } else if (kind === 'wrong_time') {
    if (!targetAttendanceId) {
      return NextResponse.json(
        { error: 'target_attendance_id is required for a wrong-time request' },
        { status: 400 }
      );
    }
    if (!isValidTimestamp(proposedTs)) {
      return NextResponse.json(
        { error: 'A valid proposed_ts is required for a wrong-time request' },
        { status: 400 }
      );
    }

    // Authz-critical: the referenced punch must belong to the requesting user, or an
    // attacker could reference (and get corrected into) someone else's attendance row.
    const { data: target, error: targetErr } = await service
      .from('hr_attendance')
      .select('id, user_id, store_id')
      .eq('id', targetAttendanceId)
      .maybeSingle();
    if (targetErr) {
      return NextResponse.json({ error: 'Failed to verify attendance record' }, { status: 500 });
    }
    if (!target) {
      return NextResponse.json({ error: 'Attendance record not found' }, { status: 404 });
    }
    if ((target.user_id as string) !== user.id) {
      return NextResponse.json({ error: 'not your attendance record' }, { status: 400 });
    }
    storeId = (target.store_id as string | null) ?? null;
  }
  // kind === 'other' — no proposed fields required, per the DB CHECK.

  if (!storeId) {
    const { data: sched, error: schedErr } = await service
      .from('hr_schedule')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('work_date', businessDate)
      .maybeSingle();
    if (schedErr) return NextResponse.json({ error: 'Failed to verify schedule' }, { status: 500 });
    if (!sched) {
      return NextResponse.json({ error: 'you are not scheduled on that date' }, { status: 400 });
    }
    storeId = sched.store_id as string;
  }

  // §Phase 0B: once the pay period covering this date is finalized, its punches are settled — a
  // correction can no longer flow into payroll, so reject it instead of creating a dead request.
  try {
    if (await isDateInFinalizedPeriod(service, businessDate, storeId ? [storeId] : [])) {
      return NextResponse.json({ error: FINALIZED_PERIOD_ERROR }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ error: 'Failed to verify pay period' }, { status: 500 });
  }

  // Abuse / duplicate guard: cap open requests, and reject a duplicate still-pending
  // request for the same date. The DB partial-unique index is the race-proof
  // backstop; this gives a clean 409/429 without a stray insert.
  const { data: pendings } = await service
    .from('hr_attendance_requests')
    .select('business_date')
    .eq('user_id', user.id)
    .eq('status', 'pending');
  const open = pendings ?? [];
  if (open.length >= MAX_OPEN_ATTENDANCE_REQUESTS) {
    return NextResponse.json({ error: 'Too many open attendance requests' }, { status: 429 });
  }
  if (open.some((p) => p.business_date === businessDate)) {
    return NextResponse.json(
      { error: 'You already have a pending attendance request for this date' },
      { status: 409 }
    );
  }

  const { data, error } = await service
    .from('hr_attendance_requests')
    .insert({
      user_id: user.id,
      store_id: storeId,
      business_date: businessDate,
      kind,
      proposed_type: kind === 'other' ? null : proposedType,
      proposed_ts: kind === 'other' ? null : proposedTs,
      target_attendance_id: kind === 'wrong_time' ? targetAttendanceId : null,
      reason,
      status: 'pending',
    })
    .select(COLS)
    .single();
  if (error) {
    // 23505 = the partial-unique index caught a concurrent duplicate.
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'You already have a pending attendance request for this date' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Failed to file attendance request' }, { status: 500 });
  }
  return NextResponse.json({ data }, { status: 201 });
}

// GET /api/hr/ess/attendance-requests — the caller's own attendance requests.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_attendance_requests')
    .select(COLS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: 'Failed to load attendance requests' }, { status: 500 });
  }

  const rows = (data ?? []) as AttendanceRequestRow[];
  return NextResponse.json({ data: rows });
}
