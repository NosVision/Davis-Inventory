import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope } from '@/lib/hr/route-auth';
import { openBusinessDateBangkok } from '@/lib/utils/date';

// GET /api/hr/dashboard/daily?business_date=&store_id= — the manager/HR "who's in today" summary
// (§P5.3). Scoped: company-HR sees everyone; a store manager sees only their stores' staff. Buckets
// the active headcount into checked-in / on-approved-leave / not-yet-in for the business date, and
// returns the names so the page can render cards AND build a copy-to-LINE text. Read-only.
interface Person { user_id: string; name: string }

const nameOf = (p: { display_name: string | null; username: string | null } | null) =>
  p?.display_name || p?.username || '—';

export async function GET(request: NextRequest) {
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const sp = request.nextUrl.searchParams;
  const dateParam = sp.get('business_date');
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: 'Invalid business_date' }, { status: 400 });
  }
  const businessDate = dateParam || openBusinessDateBangkok();
  const storeFilter = sp.get('store_id');

  const service = createServiceClient();

  // The store set we're allowed to look at: explicit ?store_id must be within scope.
  let storeIds: string[] | null = scope.storeIds; // null = all (company-HR)
  if (storeFilter) {
    if (storeIds && !storeIds.includes(storeFilter)) {
      return NextResponse.json({ error: 'store out of scope' }, { status: 403 });
    }
    storeIds = [storeFilter];
  }

  // user_ids visible in scope (via user_stores). null → no store restriction (all employees).
  let scopedUserIds: Set<string> | null = null;
  if (storeIds) {
    const { data: us, error } = await service.from('user_stores').select('user_id').in('store_id', storeIds);
    if (error) return NextResponse.json({ error: 'Scope lookup failed' }, { status: 500 });
    scopedUserIds = new Set((us ?? []).map((r) => r.user_id as string));
    if (scopedUserIds.size === 0) {
      return NextResponse.json({ data: emptyResult(businessDate) });
    }
  }

  // Active employees in scope.
  let empQuery = service
    .from('hr_employees')
    .select('profile_id, status, profile:profiles!hr_employees_profile_id_fkey(display_name, username, active)')
    .eq('status', 'active');
  if (scopedUserIds) empQuery = empQuery.in('profile_id', [...scopedUserIds]);
  const { data: empRows, error: empErr } = await empQuery;
  if (empErr) return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 });

  const employees: Person[] = (empRows ?? [])
    .filter((e) => (e.profile as { active?: boolean } | null)?.active !== false)
    .map((e) => ({ user_id: e.profile_id as string, name: nameOf(e.profile as never) }));
  const empIds = new Set(employees.map((e) => e.user_id));
  const nameById = new Map(employees.map((e) => [e.user_id, e.name]));

  // Approved leaves covering the business date.
  const { data: leaveRows, error: lvErr } = await service
    .from('hr_leaves')
    .select('user_id')
    .eq('status', 'approved')
    .lte('from_date', businessDate)
    .gte('to_date', businessDate);
  if (lvErr) return NextResponse.json({ error: 'Failed to load leaves' }, { status: 500 });
  const onLeaveIds = new Set((leaveRows ?? []).map((r) => r.user_id as string).filter((id) => empIds.has(id)));

  // Distinct 'in' punches for the date (scoped by store).
  let attQuery = service
    .from('hr_attendance')
    .select('user_id')
    .eq('business_date', businessDate)
    .eq('type', 'in');
  if (storeIds) attQuery = attQuery.in('store_id', storeIds);
  const { data: attRows, error: attErr } = await attQuery;
  if (attErr) return NextResponse.json({ error: 'Failed to load attendance' }, { status: 500 });
  const checkedInIds = new Set((attRows ?? []).map((r) => r.user_id as string).filter((id) => empIds.has(id)));

  const toList = (ids: Set<string>): Person[] =>
    [...ids].map((id) => ({ user_id: id, name: nameById.get(id) ?? '—' })).sort((a, b) => a.name.localeCompare(b.name));

  const checkedIn = toList(checkedInIds);
  const onLeave = toList(onLeaveIds);
  const notIn = employees
    .filter((e) => !checkedInIds.has(e.user_id) && !onLeaveIds.has(e.user_id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    data: {
      business_date: businessDate,
      headcount: employees.length,
      checked_in: checkedIn,
      on_leave: onLeave,
      not_in: notIn,
    },
  });
}

function emptyResult(businessDate: string) {
  return { business_date: businessDate, headcount: 0, checked_in: [], on_leave: [], not_in: [] };
}
