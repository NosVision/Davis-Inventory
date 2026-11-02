import { NextResponse } from 'next/server';
import { createClient, createServiceClient, getSessionUser } from '@/lib/supabase/server';
import { loadSwapCoworkers } from '@/lib/hr/swap-coworkers';
import { todayBangkok } from '@/lib/utils/date';

// GET /api/hr/ess/coworkers — the caller's store-mates, so a requester can pick a
// day-off swap counterpart. Use the HR roster rather than raw login-access grants:
// disabled/retired/system accounts are not coworkers, and HR work assignments count.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getSessionUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();

  // The caller's own store assignments.
  const { data: myStores, error: myErr } = await service
    .from('user_stores')
    .select('store_id')
    .eq('user_id', user.id);
  if (myErr) return NextResponse.json({ error: 'Failed to load coworkers' }, { status: 500 });
  const { data: employee, error: employeeErr } = await service
    .from('hr_employees')
    .select('work_store_id')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (employeeErr) return NextResponse.json({ error: 'Failed to load coworkers' }, { status: 500 });
  const storeIds = [...new Set([
    ...(myStores ?? []).map((r) => r.store_id as string),
    ...(employee?.work_store_id ? [employee.work_store_id as string] : []),
  ])];
  if (!storeIds.length) return NextResponse.json({ data: [] });

  try {
    const data = await loadSwapCoworkers(service, storeIds, user.id, todayBangkok());
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: 'Failed to load coworkers' }, { status: 500 });
  }
}
