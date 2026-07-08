import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { HrBackButton } from './_components/hr-back-button';

/**
 * Server-side guard for the whole /hr subtree (defense-in-depth on top of menu
 * hiding + RLS). Only owner or a user granted `can_manage_hr` may enter — mirrors
 * the DB `can_manage_hr()` gate. The RLS-respecting client can read the caller's
 * own profile + own permissions (existing self-view policies), so no service role.
 */
export default async function HrLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: perms }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    supabase.from('user_permissions').select('permission').eq('user_id', user.id),
  ]);

  const isOwner = profile?.role === 'owner';
  const isHr = profile?.role === 'hr';
  const hasHrGrant = (perms ?? []).some((p) => p.permission === 'can_manage_hr');
  if (!isOwner && !isHr && !hasHrGrant) redirect('/');

  return (
    <>
      <HrBackButton />
      {children}
    </>
  );
}
