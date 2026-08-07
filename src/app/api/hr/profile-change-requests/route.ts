import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { buildFullNameMap } from '@/lib/hr/employee-name-map';

const TABLE = 'hr_profile_change_requests';
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

const COLS =
  'id, user_id, field_key, current_value, new_value, reason, status, approver_id, ' +
  'decided_at, decision_note, applied, created_at, updated_at';

const SELECT =
  `${COLS}, ` +
  'requester:profiles!hr_profile_change_requests_user_id_fkey(id, display_name, username)';

// GET /api/hr/profile-change-requests?status? — the HR approval queue (§J6).
// These requests carry sensitive bank data, so this is company-wide HR ONLY
// (requires can_manage_hr) — store managers do NOT get access.
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const status = request.nextUrl.searchParams.get('status') ?? 'pending';
  if (status !== 'all' && !STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const service = createServiceClient();
  let query = service.from(TABLE).select(SELECT);
  if (status !== 'all') query = query.eq('status', status);
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to load change requests' }, { status: 500 });

  // HR approves these against the employee record, so name the requester by their ชื่อจริง.
  const rows = (data ?? []) as unknown as { user_id: string; requester: Record<string, unknown> | null }[];
  const fullNames = await buildFullNameMap(service, rows.map((r) => r.user_id));

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      requester: r.requester ? { ...r.requester, full_name: fullNames.get(r.user_id) ?? null } : null,
    })),
  });
}
