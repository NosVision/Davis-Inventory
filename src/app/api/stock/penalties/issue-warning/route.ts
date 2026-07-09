import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { issueSopWarning } from '@/lib/stock/sop-warning';

// POST /api/stock/penalties/issue-warning  { store_id, month: 'YYYY-MM' }
// Manual "send warning to head_bar" for a store/month (owner ask 2026-07-09) — the HQ-driven path
// in Manual mode. Reads the store's current SOP points and runs the shared issuer with
// issueWarning:true (dedupes per store/month, notifies HQ/owner + issues the head_bar warning).
// HQ-only (can_manage_stock_sop / owner / hq).

async function requireStockSopManager(): Promise<
  { ok: true; userId: string } | { ok: false; res: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const service = createServiceClient();
  const [profileRes, permsRes] = await Promise.all([
    service.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    service.from('user_permissions').select('permission').eq('user_id', user.id),
  ]);
  const role = (profileRes.data as { role?: string } | null)?.role ?? '';
  const perms = (permsRes.data ?? []).map((p) => (p as { permission: string }).permission);
  if (role !== 'owner' && role !== 'hq' && !perms.includes('can_manage_stock_sop')) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, userId: user.id };
}

export async function POST(req: NextRequest) {
  const auth = await requireStockSopManager();
  if (!auth.ok) return auth.res;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const month = typeof body.month === 'string' ? body.month : '';
  if (!storeId || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'store_id and month (YYYY-MM) are required' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: cnt } = await service
    .from('v_store_monthly_sop_count')
    .select('points')
    .eq('store_id', storeId)
    .eq('month_year', month)
    .maybeSingle();
  const sopPoints = (cnt as { points?: number } | null)?.points ?? 0;

  const result = await issueSopWarning(service, {
    storeId,
    monthYear: month,
    sopPoints,
    issuedBy: auth.userId,
    issueWarning: true,
  });

  return NextResponse.json(result);
}
