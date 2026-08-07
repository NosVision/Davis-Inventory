import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, requireStoreManager } from '@/lib/hr/route-auth';
import { buildFullNameMap } from '@/lib/hr/employee-name-map';

const TABLE = 'hr_claims';
const STATUSES = ['pending', 'approved', 'rejected', 'paid', 'cancelled'];

const COLS =
  'id, user_id, store_id, company_id, claim_type, amount_satang, description, ' +
  'receipt_path, claim_date, status, approver_id, decided_at, decision_note, ' +
  'paid_at, payslip_earning_id, created_at, updated_at';

const SELECT =
  `${COLS}, ` +
  'claimant:profiles!hr_claims_user_id_fkey(id, display_name, username)';

// GET /api/hr/claims?store_id&status&user_id — the approval queue (§J2).
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
  const userId = sp.get('user_id') ?? '';

  const service = createServiceClient();
  let query = service.from(TABLE).select(SELECT);
  if (storeId) query = query.eq('store_id', storeId);
  if (status !== 'all') query = query.eq('status', status);
  if (userId) query = query.eq('user_id', userId);

  query = query.order('claim_date', { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to load claims' }, { status: 500 });

  // A claim is reimbursed through payroll, so the queue names the claimant the same way the
  // payslip does — the embed alone only knows the ชื่อเล่น.
  const rows = (data ?? []) as unknown as { user_id: string; claimant: Record<string, unknown> | null }[];
  const fullNames = await buildFullNameMap(service, rows.map((r) => r.user_id));

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      claimant: r.claimant ? { ...r.claimant, full_name: fullNames.get(r.user_id) ?? null } : null,
    })),
  });
}
