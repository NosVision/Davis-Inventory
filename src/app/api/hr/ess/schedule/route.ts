import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const MONTH_RE = /^\d{4}-\d{2}$/;

interface EssRow {
  work_date: string;
  is_day_off: boolean;
  status: string;
  note: string | null;
  shift: {
    label: string | null;
    start_time: string | null;
    end_time: string | null;
    color: string | null;
  } | null;
}

// First/last calendar day (YYYY-MM-DD) of a YYYY-MM month.
function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, '0')}` };
}

// GET /api/hr/ess/schedule?month=YYYY-MM — the CALLER's own published roster (§C).
// ESS: any authenticated user reads only their own rows, and only once published
// (status submitted/acknowledged). Draft cells stay hidden until the manager submits.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const month = request.nextUrl.searchParams.get('month') ?? '';
  // Validate before querying so a malformed month can't surface a raw cast error.
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
  }
  const { first, last } = monthRange(month);

  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_schedule')
    .select(
      'work_date, is_day_off, status, note, ' +
        'shift:hr_shift_templates(label, start_time, end_time, color)',
    )
    .eq('user_id', user.id)
    .in('status', ['submitted', 'acknowledged'])
    .gte('work_date', first)
    .lte('work_date', last)
    .order('work_date');

  if (error) return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });

  const rows = (data ?? []) as unknown as EssRow[];
  const out = rows.map((r) => ({
    work_date: r.work_date,
    is_day_off: r.is_day_off,
    status: r.status,
    note: r.note,
    shift: r.shift ?? null,
  }));

  return NextResponse.json({ data: out });
}
