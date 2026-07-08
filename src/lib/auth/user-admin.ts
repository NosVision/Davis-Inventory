import { createClient } from '@/lib/supabase/server';
import { canManageHr } from '@/lib/hr/access';

export type UserAdminAuth =
  | { ok: true; userId: string; role: string; isOwner: boolean }
  | { ok: false; error: string; status: number };

// Elevated accounts an HR (non-owner) admin may NOT create/administer — only an owner can.
export const ELEVATED_ROLES = ['accountant', 'manager', 'hq', 'hr'] as const;
// Roles a user account may be created/invited as at all (never owner/customer).
export const ASSIGNABLE_ROLES = ['staff', 'bar', 'technician', 'manager', 'accountant', 'hq', 'hr', 'cashier', 'housekeeping_staff', 'boh_staff'] as const;

/**
 * Authorization for user administration on /users (owner ask 2026-07-08): the caller must be an
 * OWNER or HR (role `hr` / a `can_manage_hr` grant). Returns the caller's role + an `isOwner` flag
 * so routes can keep the sensitive operations (minting/administering elevated accounts) owner-only.
 * Uses the RLS-respecting client (reads the caller's own profile + permissions).
 */
export async function requireUserAdmin(): Promise<UserAdminAuth> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Unauthorized', status: 401 };

  const [{ data: profile, error: profErr }, { data: perms, error: permErr }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    supabase.from('user_permissions').select('permission').eq('user_id', user.id),
  ]);
  if (profErr || permErr) return { ok: false, error: 'Authorization check failed', status: 503 };

  const role = (profile?.role as string) ?? '';
  const permissions = (perms ?? []).map((p) => p.permission as string);
  const isOwner = role === 'owner';
  if (!isOwner && !canManageHr({ role, permissions })) {
    return { ok: false, error: 'Forbidden — owner or HR only', status: 403 };
  }
  return { ok: true, userId: user.id, role, isOwner };
}
