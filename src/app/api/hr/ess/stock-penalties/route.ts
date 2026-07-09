import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { openBusinessDateBangkok } from '@/lib/utils/date';

// GET /api/hr/ess/stock-penalties — employee self-service.
// Any authenticated user may read THEIR OWN stock-penalty / SOP-point history
// (penalties.staff_id = auth user id). NOT gated by requireHrManager — this is ESS,
// reachable by every employee (mirrors /api/hr/ess/policies).
interface PenaltyRow {
  id: string;
  penalty_code: string | null;
  reason: string | null;
  amount: number | null;
  status: string | null;
  business_date: string | null;
  week_seq: number | null;
  month_year: string | null;
  created_at: string;
  included_in_quota: boolean | null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('penalties')
    .select(
      'id,penalty_code,reason,amount,status,business_date,week_seq,month_year,created_at,included_in_quota'
    )
    .eq('staff_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as PenaltyRow[];

  // Summary for the current (open) business month, e.g. '2026-07'.
  const currentMonth = openBusinessDateBangkok().slice(0, 7);
  const monthRows = rows.filter(
    (r) => r.month_year === currentMonth && r.status !== 'cancelled'
  );
  const monthPoints = monthRows.filter((r) => r.included_in_quota === true).length;
  const monthBaht = monthRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  return NextResponse.json({
    rows,
    month_points: monthPoints,
    month_baht: monthBaht,
  });
}
