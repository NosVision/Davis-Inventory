import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyUser } from '@/lib/notifications/service';

// POST /api/stock/penalties/send-to-hr  { store_id, month: 'YYYY-MM' }
// HQ forwards this store/month's money fines to HR for deduction (owner ask 2026-07-09).
// Marks pending money penalties (amount > 0) as 'sent_hr' and notifies HR — HR then decides on
// /hr/stock-deductions whether to deduct now or defer. Discipline (SOP → warning) is separate.
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
  const month = typeof body.month === 'string' ? body.month.slice(0, 7) : '';
  if (!storeId || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'store_id and month (YYYY-MM) required' }, { status: 400 });
  }

  const service = createServiceClient();

  // Mark this store/month's not-yet-sent money fines as sent_hr.
  const { data: updated, error } = await service
    .from('penalties')
    .update({ status: 'sent_hr' })
    .eq('store_id', storeId)
    .eq('month_year', month)
    .eq('status', 'pending')
    .gt('amount', 0)
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const sent = (updated ?? []).length;
  if (sent === 0) {
    return NextResponse.json({ data: { sent: 0, note: 'no pending money fines to send' } });
  }

  // Notify HR (owner + hr) that a store/month's fines are ready to deduct.
  const { data: store } = await service.from('stores').select('store_name').eq('id', storeId).maybeSingle();
  const storeName = (store as { store_name?: string } | null)?.store_name ?? '';
  const { data: hrUsers } = await service.from('profiles').select('id').in('role', ['owner', 'hr']);
  await Promise.all(
    (hrUsers ?? []).map((u) =>
      notifyUser({
        userId: (u as { id: string }).id,
        storeId,
        type: 'approval_request',
        title: '💸 มีค่าปรับสต๊อกรอหัก SV',
        body: `${storeName} เดือน ${month} — ${sent} รายการ รอ HR พิจารณาหักจากกอง SV`,
        data: { url: '/hr/stock-deductions' },
      }).catch(() => {})
    )
  );

  return NextResponse.json({ data: { sent } });
}
