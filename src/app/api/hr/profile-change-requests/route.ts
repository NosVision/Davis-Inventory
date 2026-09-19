import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { buildFullNameMap } from '@/lib/hr/employee-name-map';
import { payHiddenProfileIds, redactBankKeys } from '@/lib/hr/pay-visibility';

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
  const rows = (data ?? []) as unknown as {
    user_id: string;
    field_key: string;
    current_value: Record<string, unknown> | null;
    new_value: Record<string, unknown> | null;
    requester: Record<string, unknown> | null;
  }[];
  const [fullNames, hiddenProfiles] = await Promise.all([
    buildFullNameMap(service, rows.map((r) => r.user_id)),
    // Bank details are pay (pay-visibility.ts). A request from someone whose pay this caller may
    // not see still shows up — HR must know it is waiting for someone else — but with the account
    // numbers blanked, and `pay_hidden` so the page can say who has to decide it (2026-09-19).
    payHiddenProfileIds(service, auth.userId),
  ]);

  return NextResponse.json({
    data: rows.map((r) => {
      const payHidden = r.field_key === 'bank_account' && hiddenProfiles.has(r.user_id);
      return {
        ...r,
        current_value: payHidden ? redactBankKeys(r.current_value) : r.current_value,
        new_value: payHidden ? redactBankKeys(r.new_value) : r.new_value,
        pay_hidden: payHidden,
        requester: r.requester ? { ...r.requester, full_name: fullNames.get(r.user_id) ?? null } : null,
      };
    }),
  });
}
