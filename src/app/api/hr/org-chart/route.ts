import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope } from '@/lib/hr/route-auth';

// GET /api/hr/org-chart — flat reporting list for the org chart (P1.5): every active/probation
// employee with name/avatar/position/department + supervisor_id (→ profiles.id). The client
// assembles the tree; scope follows the caller (company HR = all, store manager = their stores).
interface Row {
  profile_id: string;
  supervisor_id: string | null;
  status: string;
  profile: { display_name: string | null; username: string | null; avatar_url: string | null; active: boolean | null } | null;
  position: { name: string | null } | null;
  department: { name: string | null } | null;
}

export async function GET(request: NextRequest) {
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const storeFilter = request.nextUrl.searchParams.get('store_id');
  let storeIds: string[] | null = scope.storeIds;
  if (storeFilter) {
    if (storeIds && !storeIds.includes(storeFilter)) {
      return NextResponse.json({ error: 'store out of scope' }, { status: 403 });
    }
    storeIds = [storeFilter];
  }

  const service = createServiceClient();
  let scopedUserIds: Set<string> | null = null;
  if (storeIds) {
    const { data: us, error } = await service.from('user_stores').select('user_id').in('store_id', storeIds);
    if (error) return NextResponse.json({ error: 'Scope lookup failed' }, { status: 500 });
    scopedUserIds = new Set((us ?? []).map((r) => r.user_id as string));
    if (scopedUserIds.size === 0) return NextResponse.json({ data: [] });
  }

  let q = service
    .from('hr_employees')
    .select(
      'profile_id, supervisor_id, status, ' +
        'profile:profiles!hr_employees_profile_id_fkey(display_name, username, avatar_url, active), ' +
        'position:hr_positions(name), department:hr_departments(name)'
    )
    .in('status', ['active', 'probation']);
  if (scopedUserIds) q = q.in('profile_id', [...scopedUserIds]);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: 'Failed to load org chart' }, { status: 500 });

  const rows = ((data ?? []) as unknown as Row[])
    .filter((e) => e.profile?.active !== false)
    .map((e) => ({
      id: e.profile_id,
      supervisor_id: e.supervisor_id,
      name: e.profile?.display_name || e.profile?.username || '—',
      username: e.profile?.username ?? null,
      avatar_url: e.profile?.avatar_url ?? null,
      position: e.position?.name ?? null,
      department: e.department?.name ?? null,
      status: e.status,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));

  return NextResponse.json({ data: rows });
}
