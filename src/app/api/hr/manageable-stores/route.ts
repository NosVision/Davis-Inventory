import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { canManageHr } from '@/lib/hr/access';

interface StoreRow {
  id: string;
  store_code: string | null;
  store_name: string | null;
}

// GET /api/hr/manageable-stores — the stores the caller may schedule (§C).
// Company-wide HR (owner / can_manage_hr) → all active stores. Otherwise → only
// the active stores named in the caller's `hr_manager_scopes`.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [profileRes, permsRes] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    supabase.from('user_permissions').select('permission').eq('user_id', user.id),
  ]);
  if (profileRes.error || permsRes.error) {
    return NextResponse.json({ error: 'authorization check failed' }, { status: 503 });
  }
  const role = (profileRes.data?.role as string) ?? '';
  const permissions = (permsRes.data ?? []).map((p) => p.permission as string);

  const service = createServiceClient();

  // Company-wide HR and the HQ scheduler → every active store. `hq` used to fall through to the
  // scopes lookup, which is always empty for them, so the HQ scheduler's store picker came back
  // blank and they could not schedule anything.
  if (role === 'hq' || canManageHr({ role, permissions })) {
    const { data, error } = await service
      .from('stores')
      .select('id, store_code, store_name')
      .eq('active', true)
      .order('store_name');
    if (error) return NextResponse.json({ error: 'Failed to load stores' }, { status: 500 });
    return NextResponse.json({ data: (data ?? []) as StoreRow[] });
  }

  // Otherwise → only the stores this manager is scoped to.
  const { data: scopes, error: scopeErr } = await service
    .from('hr_manager_scopes')
    .select('store_id')
    .eq('user_id', user.id);
  if (scopeErr) return NextResponse.json({ error: 'Failed to load stores' }, { status: 500 });

  const storeIds = (scopes ?? []).map((s) => s.store_id as string);
  if (storeIds.length === 0) return NextResponse.json({ data: [] });

  const { data, error } = await service
    .from('stores')
    .select('id, store_code, store_name')
    .eq('active', true)
    .in('id', storeIds)
    .order('store_name');
  if (error) return NextResponse.json({ error: 'Failed to load stores' }, { status: 500 });
  return NextResponse.json({ data: (data ?? []) as StoreRow[] });
}
