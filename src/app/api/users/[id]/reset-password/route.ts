import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { canManageHr } from '@/lib/hr/access';

const DEFAULT_RESET_PASSWORD = '123456';

/**
 * POST /api/users/[id]/reset-password
 *
 * Owner/manager-driven password reset. Resets to a fixed default password
 * (`123456`); the user must change it on next login. Audit logged.
 */
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [{ data: callerProfile }, { data: callerPerms }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', caller.id).single(),
    supabase.from('user_permissions').select('permission').eq('user_id', caller.id),
  ]);

  const callerRole = (callerProfile?.role as string) ?? '';
  const callerPermissions = (callerPerms ?? []).map((p) => p.permission as string);
  // Owner/accountant/hq/manager (existing) OR HR (owner ask 2026-07-08) may reset passwords.
  const allowed =
    ['owner', 'accountant', 'hq', 'manager'].includes(callerRole) ||
    canManageHr({ role: callerRole, permissions: callerPermissions });
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const service = createServiceClient();

  // Verify target user exists in profiles
  const { data: target } = await service
    .from('profiles')
    .select('id, username, role')
    .eq('id', id)
    .single();

  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Only an owner may reset an owner/accountant/hq account.
  if (callerRole !== 'owner' && ['owner', 'accountant', 'hq'].includes(target.role)) {
    return NextResponse.json({ error: 'Only an owner can reset this account' }, { status: 403 });
  }
  // Manager stays limited to staff/bar.
  if (callerRole === 'manager' && !['staff', 'bar'].includes(target.role)) {
    return NextResponse.json({ error: 'Manager can only reset staff/bar passwords' }, { status: 403 });
  }

  const newPassword = DEFAULT_RESET_PASSWORD;

  const { error: updErr } = await service.auth.admin.updateUserById(id, { password: newPassword });
  if (updErr) {
    return NextResponse.json({ error: 'Failed to reset password: ' + updErr.message }, { status: 500 });
  }

  // Flag user as needing to change password on next login
  await service.from('profiles').update({ must_change_password: true }).eq('id', id);

  // Audit log (no store_id since this is account-level)
  await service.from('audit_logs').insert({
    action_type: 'PASSWORD_RESET_BY_ADMIN',
    table_name: 'auth.users',
    record_id: id,
    new_value: { username: target.username, reset_by: caller.id },
    changed_by: caller.id,
  });

  return NextResponse.json({
    success: true,
    password: newPassword,
    username: target.username,
  });
}
