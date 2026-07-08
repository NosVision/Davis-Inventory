import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Server-side guard for /users (+ /users/invitations, /users/[id]/permissions).
 * User administration moved under HR (owner ask 2026-07-08): only an owner, the HR role, or a user
 * granted `can_manage_hr` may enter — mirrors the /hr subtree gate. The RLS-respecting client can
 * read the caller's own profile + permissions via existing self-view policies, so no service role.
 */
export default async function UsersLayout({ children }: { children: React.ReactNode }) {
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

  return <>{children}</>;
}
