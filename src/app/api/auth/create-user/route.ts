import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUserAdmin, ASSIGNABLE_ROLES } from '@/lib/auth/user-admin';

export async function POST(request: NextRequest) {
  // Owner + HR may create users; only an owner may mint elevated-role accounts.
  const admin = await requireUserAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { username, password, role, displayName, storeId, storeIds } = (await request.json()) as {
    username: string;
    password: string;
    role: string;
    displayName: string | null;
    storeId?: string | null;
    storeIds?: string[];
  };

  if (!username || !password || !role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }
  // Owner ask 2026-07-23: HR may create/assign every non-owner role (ASSIGNABLE_ROLES
  // never contains 'owner', so that stays impossible for everyone here).

  const serviceClient = createServiceClient();
  const email = `${username.trim().toLowerCase()}@stockmanager.app`;

  // Create auth user
  const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, role },
  });

  if (authError) {
    if (authError.message.includes('already been registered')) {
      return NextResponse.json({ error: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' }, { status: 409 });
    }
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  if (!authData.user) {
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }

  // Update profile
  await serviceClient
    .from('profiles')
    .update({
      username: username.trim().toLowerCase(),
      role,
      display_name: displayName,
      active: true,
      created_by: admin.userId,
    })
    .eq('id', authData.user.id);

  // Assign stores (supports multiple branches, e.g. a technician covering
  // several stores). Falls back to the legacy single storeId field.
  const ids = Array.isArray(storeIds)
    ? Array.from(new Set(storeIds.filter((s): s is string => !!s)))
    : storeId
      ? [storeId]
      : [];
  if (ids.length > 0) {
    await serviceClient
      .from('user_stores')
      .insert(ids.map((sid) => ({ user_id: authData.user.id, store_id: sid })));
  }

  return NextResponse.json({ userId: authData.user.id });
}
