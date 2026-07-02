import { createClient } from '@/lib/supabase/server';
import { canManageHr } from '@/lib/hr/access';

export type HrAuthResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; error: string; status: number };

/**
 * Auth + HR authorization for HR API routes. Returns the caller's profile id AND
 * role when they are owner or hold `can_manage_hr`; otherwise a `{ error, status }`.
 * The caller role lets routes gate privileged actions (e.g. only owner may onboard
 * elevated roles). Uses the RLS-respecting client (reads caller's own profile/perms).
 *
 * Distinguishes a genuine backend failure (503) from a real permission denial (403)
 * so an infra blip is not misdiagnosed as an HR-permission bug across every route.
 */
export async function requireHrManager(): Promise<HrAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Unauthorized', status: 401 };

  const [profileRes, permsRes] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    supabase.from('user_permissions').select('permission').eq('user_id', user.id),
  ]);

  if (profileRes.error || permsRes.error) {
    console.error('requireHrManager: auth lookup failed', {
      profileErr: profileRes.error?.message,
      permsErr: permsRes.error?.message,
    });
    return { ok: false, error: 'HR authorization check failed', status: 503 };
  }

  const role = (profileRes.data?.role as string) ?? '';
  const permissions = (permsRes.data ?? []).map((p) => p.permission as string);

  if (!canManageHr({ role, permissions })) {
    return { ok: false, error: 'Forbidden — requires can_manage_hr', status: 403 };
  }
  return { ok: true, userId: user.id, role };
}
