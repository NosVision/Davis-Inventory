import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope } from '@/lib/hr/route-auth';

// GET /api/hr/dashboard/badges — per-area "needs HR action" counts that drive the badge numbers on
// the HR hub tiles + the sidebar menu (owner ask 2026-07-08). Scoped: company-HR counts everyone;
// a store manager counts only their stores' employees. All counts are head-only (fast, no rows).
type SB = ReturnType<typeof createServiceClient>;

// [tile key, table, status column, needs-action value, the row's employee column]
const SOURCES: { key: string; table: string; col: string; val: string; userCol: string }[] = [
  { key: 'leave', table: 'hr_leaves', col: 'status', val: 'pending', userCol: 'user_id' },
  { key: 'attendance', table: 'hr_attendance', col: 'review_status', val: 'pending', userCol: 'user_id' },
  { key: 'attendanceReq', table: 'hr_attendance_requests', col: 'status', val: 'pending', userCol: 'user_id' },
  { key: 'otReq', table: 'hr_ot_requests', col: 'status', val: 'pending', userCol: 'user_id' },
  { key: 'swaps', table: 'hr_dayoff_swaps', col: 'status', val: 'pending', userCol: 'requester_id' },
  { key: 'claims', table: 'hr_claims', col: 'status', val: 'pending', userCol: 'user_id' },
  { key: 'profileRequests', table: 'hr_profile_change_requests', col: 'status', val: 'pending', userCol: 'user_id' },
  { key: 'documentRequests', table: 'hr_document_requests', col: 'status', val: 'requested', userCol: 'profile_id' },
  { key: 'identityClaims', table: 'hr_pending_identities', col: 'status', val: 'claimed', userCol: 'claimed_by' },
];

async function countPending(
  service: SB,
  src: (typeof SOURCES)[number],
  userIds: string[] | null
): Promise<number> {
  let q = service.from(src.table).select('id', { count: 'exact', head: true }).eq(src.col, src.val);
  if (userIds) q = q.in(src.userCol, userIds); // scoped manager → only their employees
  const { count } = await q;
  return count ?? 0;
}

export async function GET() {
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const service = createServiceClient();

  // Scoped manager: restrict to their stores' employees. Company-HR (storeIds null) counts everyone.
  let userIds: string[] | null = null;
  if (scope.storeIds) {
    const { data } = await service.from('user_stores').select('user_id').in('store_id', scope.storeIds);
    userIds = [...new Set((data ?? []).map((r) => r.user_id as string))];
  }

  const results = await Promise.all(SOURCES.map((s) => countPending(service, s, userIds)));
  const byKey: Record<string, number> = {};
  SOURCES.forEach((s, i) => { byKey[s.key] = results[i]; });

  // The HR hub's "requests" tile covers both time-correction and OT requests.
  const data = {
    leave: byKey.leave,
    attendance: byKey.attendance,
    requests: byKey.attendanceReq + byKey.otReq,
    swaps: byKey.swaps,
    claims: byKey.claims,
    profileRequests: byKey.profileRequests,
    documentRequests: byKey.documentRequests,
    identityClaims: byKey.identityClaims,
  };
  const total = Object.values(data).reduce((a, b) => a + b, 0);

  return NextResponse.json({ data: { ...data, total } });
}
