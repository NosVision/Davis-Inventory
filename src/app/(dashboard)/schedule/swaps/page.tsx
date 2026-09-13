import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { canManageHr } from '@/lib/hr/access';
import { DayoffSwapQueue } from '@/components/hr/dayoff-swap-queue';

// Day-off swap approvals for the people who own a store's roster — its manager or captain (client
// decision 2026-07-20; captains 2026-08-14). Lives OUTSIDE /hr, which is HR-only: the queue used to
// sit at /hr/swaps alone, so the captains it was built for could never open it (owner report
// 2026-09-13). Mirrors the API gate, requireStoreManager(store, 'schedule'); company HR may use this
// door too and gets the HR view.
export default async function StoreSwapsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: perms }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    supabase.from('user_permissions').select('permission').eq('user_id', user.id),
  ]);
  const role = (profile?.role as string) ?? '';
  const permissions = (perms ?? []).map((p) => p.permission as string);
  if (canManageHr({ role, permissions })) return <DayoffSwapQueue mode="hr" />;

  // Service client: hr_manager_scopes is not readable under the caller's own RLS.
  const { data: scope } = await createServiceClient()
    .from('hr_manager_scopes')
    .select('id')
    .eq('user_id', user.id)
    .eq('can_schedule', true)
    .limit(1)
    .maybeSingle();
  if (!scope) redirect('/');

  return <DayoffSwapQueue mode="store" />;
}
