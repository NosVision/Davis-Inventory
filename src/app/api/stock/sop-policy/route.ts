import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logHrAudit } from '@/lib/hr/audit';
import { STOCK_SOP_CATEGORY } from '@/lib/stock/penalty-engine';

// The stock SOP is a normal hr_policies row (category = STOCK_SOP_CATEGORY, target_roles
// bar/head_bar) but MANAGED BY HQ, not HR (owner ask 2026-07-10). These routes let HQ view + edit
// it (with the same version-bump-on-content-change → re-acknowledge rule as the HR policy editor),
// scoped so HQ can only touch stock-category policies. Gated: can_manage_stock_sop / owner / hq.

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

// GET /api/stock/sop-policy — the stock SOP policy + how many bar/head_bar have accepted it.
export async function GET() {
  const auth = await requireStockSopManager();
  if (!auth.ok) return auth.res;
  const service = createServiceClient();

  const { data: policy } = await service
    .from('hr_policies')
    .select('id, title, category, body, version, active, target_roles, updated_at')
    .eq('category', STOCK_SOP_CATEGORY)
    .order('sort_order')
    .limit(1)
    .maybeSingle();

  if (!policy) return NextResponse.json({ data: { policy: null } });

  const p = policy as { id: string; version: number };
  const [{ count: ackedCount }, { data: eligible }] = await Promise.all([
    service
      .from('hr_policy_acknowledgements')
      .select('id', { count: 'exact', head: true })
      .eq('policy_id', p.id)
      .eq('policy_version', p.version),
    service.from('profiles').select('id', { count: 'exact', head: false }).in('role', ['bar', 'head_bar']),
  ]);

  return NextResponse.json({
    data: {
      policy,
      acked_count: ackedCount ?? 0,
      eligible_count: (eligible ?? []).length,
    },
  });
}

// PUT /api/stock/sop-policy — update the stock SOP { id, title?, body?, active?, bumpVersion? }.
export async function PUT(req: NextRequest) {
  const auth = await requireStockSopManager();
  if (!auth.ok) return auth.res;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: current, error: fetchErr } = await service
    .from('hr_policies')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !current) return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
  // Guard: HQ may only edit stock-category policies via this route.
  if ((current as { category?: string }).category !== STOCK_SOP_CATEGORY) {
    return NextResponse.json({ error: 'Not a stock SOP policy' }, { status: 403 });
  }

  const update: Record<string, unknown> = {};
  let contentChanged = false;
  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    update.title = title;
    if (title !== current.title) contentChanged = true;
  }
  if ('body' in body) {
    const policyBody = typeof body.body === 'string' ? body.body : null;
    update.body = policyBody;
    if (policyBody !== current.body) contentChanged = true;
  }
  if ('active' in body) {
    if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'active must be boolean' }, { status: 400 });
    update.active = body.active;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  // A content change (or explicit bump) publishes a new version → bar/head_bar re-acknowledge.
  if (body.bumpVersion === true || contentChanged) {
    update.version = (Number(current.version) || 0) + 1;
  }
  update.updated_by = auth.userId;

  const { data, error } = await service
    .from('hr_policies')
    .update(update)
    .eq('id', id)
    .eq('version', current.version)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Policy was modified elsewhere, please reload' }, { status: 409 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: 'hr_policies',
    recordId: id,
    before: current,
    after: data,
    reason: 'stock SOP edited by HQ',
  });

  return NextResponse.json({ data });
}
