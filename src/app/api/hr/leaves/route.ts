import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, requireStoreManager } from '@/lib/hr/route-auth';

const TABLE = 'hr_leaves';
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

const COLS =
  'id, user_id, store_id, company_id, leave_type_id, from_date, to_date, days, reason, ' +
  'cert_path, status, approver_id, decided_at, decision_note, created_at, updated_at';

const SELECT =
  `${COLS}, ` +
  'requester:profiles!hr_leaves_user_id_fkey(id, display_name, username), ' +
  'leave_type:hr_leave_types(code, name_th, name_en)';

// GET /api/hr/leaves?store_id&status? — the approval queue (§E).
// With store_id: store-manager guarded, scoped to that store.
// Without store_id: company-wide HR view (requires can_manage_hr).
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeId = sp.get('store_id') ?? '';

  const auth = storeId ? await requireStoreManager(storeId) : await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const status = sp.get('status') ?? 'pending';
  if (status !== 'all' && !STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const service = createServiceClient();
  let query = service.from(TABLE).select(SELECT);
  if (storeId) query = query.eq('store_id', storeId);
  if (status !== 'all') query = query.eq('status', status);

  // Pending: soonest-starting first (act on the nearest leave). Otherwise newest first.
  query =
    status === 'pending'
      ? query.order('from_date', { ascending: true })
      : query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to load leaves' }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
