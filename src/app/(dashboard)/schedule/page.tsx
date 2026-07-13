import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ScheduleWorkspace from '@/app/(dashboard)/hr/schedule/page';

// Dedicated HQ scheduling page (§C). Lives OUTSIDE /hr (which is HR-only) so the HQ scheduler role
// can build rosters here without being granted the full HR module. Access: hq / hr / owner /
// can_manage_hr — the same set the schedule API's requireScheduler gate admits. Renders the shared
// schedule workspace; the roster is drafted here and PUBLISHED (which notifies HR to acknowledge).
export default async function HqSchedulePage() {
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
  const allowed =
    role === 'hq' || role === 'owner' || role === 'hr' || permissions.includes('can_manage_hr');
  if (!allowed) redirect('/');

  return <ScheduleWorkspace />;
}
