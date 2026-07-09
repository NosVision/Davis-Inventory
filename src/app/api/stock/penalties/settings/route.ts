import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// PUT /api/stock/penalties/settings  { auto_hr: boolean }
// Toggle the group-wide "Auto send-to-HR" mode for stock SOP (owner ask 2026-07-09): in Auto mode,
// crossing the monthly SOP threshold auto-issues the head_bar warning; in Manual mode HQ presses the
// "send warning" button instead. Stored in hr_policy_settings key 'stock_escalation_auto_hr'.
// HQ-only (can_manage_stock_sop / owner / hq). Writes via the service client (bypasses RLS).

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

export async function PUT(req: NextRequest) {
  const auth = await requireStockSopManager();
  if (!auth.ok) return auth.res;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.auto_hr !== 'boolean') {
    return NextResponse.json({ error: 'auto_hr (boolean) is required' }, { status: 400 });
  }
  const autoHr = body.auto_hr;

  const service = createServiceClient();
  const { error } = await service.from('hr_policy_settings').upsert(
    {
      key: 'stock_escalation_auto_hr',
      value: autoHr,
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, auto_hr: autoHr });
}
