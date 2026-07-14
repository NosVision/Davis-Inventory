import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { todayBangkok } from '@/lib/utils/date';
import { buildLeaveSummary } from '@/lib/hr/leave-summary';

// GET /api/hr/ess/leaves/summary — the caller's OWN leave quota/usage for the current
// Bangkok year (self only; any logged-in user). Computation lives in lib/hr/leave-summary
// (shared with /api/hr/ess/dashboard).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .select('id, company_id')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to load employee' }, { status: 500 });
  // Not a registered employee (or no company) → nothing to summarise.
  if (!emp || !emp.company_id) return NextResponse.json({ data: null });

  const year = Number(todayBangkok().slice(0, 4));
  const summary = await buildLeaveSummary(service, user.id, { id: emp.id as string, company_id: emp.company_id as string }, year);
  if (!summary) return NextResponse.json({ error: 'Failed to load leave summary' }, { status: 500 });

  return NextResponse.json({ data: summary });
}
