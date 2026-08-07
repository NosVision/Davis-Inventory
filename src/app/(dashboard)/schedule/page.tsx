import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import ScheduleWorkspace from '@/app/(dashboard)/hr/schedule/page';

// The scheduling workspace. Lives OUTSIDE /hr (which is HR-only) so people who schedule but are
// not HR can reach it: the HQ scheduler role, and — since 2026-08-07 — a venue MANAGER, who now
// builds their own store's roster. Mirrors the API's requireSchedulerForScope gate: hq / hr /
// owner / can_manage_hr get every store, a scoped manager gets the stores they run
// (hr_manager_scopes); the store picker itself is filtered by /api/hr/manageable-stores.
//
// A roster is drafted here and PUBLISHED, which is final — the old HR acknowledgement step is gone.
export default async function SchedulePage() {
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
  let allowed =
    role === 'hq' || role === 'owner' || role === 'hr' || permissions.includes('can_manage_hr');

  // Not company-wide — but a venue manager still schedules the venues they run. Service client:
  // hr_manager_scopes is not readable under the caller's own RLS.
  if (!allowed) {
    const { data: scope } = await createServiceClient()
      .from('hr_manager_scopes')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    allowed = !!scope;
  }
  if (!allowed) redirect('/');

  return <ScheduleWorkspace />;
}
