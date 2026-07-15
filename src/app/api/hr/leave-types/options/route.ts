import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { fetchLeaveTypeOptions } from '@/lib/hr/leave-types';

// GET /api/hr/leave-types/options?company_id=… — the canonical "pick a leave type" list:
// ACTIVE types for the given company + global, ordered by sort_order. Auth-any (leave-type
// categories are not sensitive; the ESS endpoint is already auth-any) so store-scoped managers
// — who lack the company-wide can_manage_hr the config route requires — can populate their
// backfill / attendance-review / day-edit pickers. With no company_id, resolves the caller's own
// company. Single source of truth (lib/hr/leave-types#fetchLeaveTypeOptions) shared across surfaces.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  let companyId = request.nextUrl.searchParams.get('company_id');
  if (!companyId) {
    const { data: emp } = await service
      .from('hr_employees')
      .select('company_id')
      .eq('profile_id', user.id)
      .maybeSingle();
    companyId = (emp?.company_id as string | null) ?? null;
  }

  const options = await fetchLeaveTypeOptions(service, companyId);
  if (options === null) return NextResponse.json({ error: 'Failed to load leave types' }, { status: 500 });
  return NextResponse.json({ data: options });
}
