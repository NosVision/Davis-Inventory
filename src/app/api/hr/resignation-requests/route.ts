import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope } from '@/lib/hr/route-auth';
import { buildFullNameMap } from '@/lib/hr/employee-name-map';

const TABLE = 'hr_resignation_requests';

const COLS =
  'id, user_id, company_id, store_id, notice_date, last_working_date, reason, ' +
  'signature_path, status, offboarding_id, reviewed_by, reviewed_at, review_note, ' +
  'created_at, updated_at';

const EMPLOYEE_EMBED =
  'employee:profiles!hr_resignation_requests_user_id_fkey(id, display_name, username)';
const COMPANY_EMBED = 'company:hr_companies(id, name)';

// GET /api/hr/resignation-requests — HR review queue. Query: status? (default pending),
// company_id?. Newest first. Scope mirrors the offboarding list: company-wide HR sees
// everything; a scoped manager sees only their stores' requests.
export async function GET(request: NextRequest) {
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const status = request.nextUrl.searchParams.get('status') ?? 'pending';
  const companyId = request.nextUrl.searchParams.get('company_id');

  const service = createServiceClient();
  let query = service.from(TABLE).select(`${COLS}, ${EMPLOYEE_EMBED}, ${COMPANY_EMBED}`);
  if (status !== 'all') query = query.eq('status', status);
  if (companyId) query = query.eq('company_id', companyId);
  if (scope.storeIds) query = query.in('store_id', scope.storeIds);
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Same reason as the offboarding queue this feeds: a resignation is named under the ชื่อจริง.
  const rows = (data ?? []) as unknown as { user_id: string; employee: Record<string, unknown> | null }[];
  const fullNames = await buildFullNameMap(service, rows.map((r) => r.user_id));

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      employee: r.employee ? { ...r.employee, full_name: fullNames.get(r.user_id) ?? null } : null,
    })),
  });
}
