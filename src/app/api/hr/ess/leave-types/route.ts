import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { fetchLeaveTypeOptions } from '@/lib/hr/leave-types';

// GET /api/hr/ess/leave-types — ACTIVE leave types the CALLER can file against.
// Auth-any (not HR-gated). Scoped to the caller's company plus any global
// (company_id IS NULL) types, ordered by sort_order. Uses the same source of truth
// (lib/hr/leave-types#fetchLeaveTypeOptions) as the shared /api/hr/leave-types/options.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();

  // Find the caller's company so they only see their own company's leave types.
  const { data: emp } = await service
    .from('hr_employees')
    .select('company_id')
    .eq('profile_id', user.id)
    .maybeSingle();

  const options = await fetchLeaveTypeOptions(service, (emp?.company_id as string | null) ?? null);
  if (options === null) return NextResponse.json({ error: 'Failed to load leave types' }, { status: 500 });
  return NextResponse.json({ data: options });
}
