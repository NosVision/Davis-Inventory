import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar date, not just the shape — rejects '2026-02-30' before it reaches
// the DB (which would otherwise 500 on a date-out-of-range cast).
function isCalendarDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

// GET /api/hr/ess/my-punches?date=YYYY-MM-DD — the caller's OWN attendance punches for a
// business date, so the "wrong_time" correction form can offer the employee their own
// punches to correct. Auth-any, but strictly self-scoped (user_id = caller) — it must
// never be usable to browse another user's punches.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const date = request.nextUrl.searchParams.get('date') ?? '';
  if (!isCalendarDate(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_attendance')
    .select('id, type, ts')
    .eq('user_id', user.id)
    .eq('business_date', date)
    .order('ts', { ascending: true });
  if (error) return NextResponse.json({ error: 'Failed to load punches' }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
