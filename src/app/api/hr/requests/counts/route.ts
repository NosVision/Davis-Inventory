import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope } from '@/lib/hr/route-auth';

// GET /api/hr/requests/counts?store_id=<id|all> — pending counts for the two approval
// queues behind the /hr/requests tabs, over the same scope the caller may act on.
// The hub badge already sums these two queues; the tabs need the split so the approver
// can see which queue holds the pending items without opening each tab.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeParam = sp.get('store_id') ?? 'all';

  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  // null = company-wide HR (every store); an array = this manager's stores only.
  let allowed: string[] | null;
  if (storeParam && storeParam !== 'all') {
    if (scope.storeIds && !scope.storeIds.includes(storeParam)) {
      return NextResponse.json({ error: 'Forbidden — not a manager of this store' }, { status: 403 });
    }
    allowed = [storeParam];
  } else {
    allowed = scope.storeIds;
  }

  const service = createServiceClient();
  const countPending = async (table: 'hr_ot_requests' | 'hr_attendance_requests') => {
    let query = service.from(table).select('id', { count: 'exact', head: true }).eq('status', 'pending');
    if (allowed) query = query.in('store_id', allowed.length > 0 ? allowed : ['00000000-0000-0000-0000-000000000000']);
    const { count, error } = await query;
    if (error) throw new Error(`Failed to count ${table}`);
    return count ?? 0;
  };

  try {
    const [ot, attendance] = await Promise.all([
      countPending('hr_ot_requests'),
      countPending('hr_attendance_requests'),
    ]);
    return NextResponse.json({ data: { ot, attendance } });
  } catch {
    return NextResponse.json({ error: 'Failed to load request counts' }, { status: 500 });
  }
}
