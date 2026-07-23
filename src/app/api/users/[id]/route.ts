import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUserAdmin, ASSIGNABLE_ROLES } from '@/lib/auth/user-admin';

// Accounts only an owner may administer (enable/disable, re-assign stores).
// Loosened 2026-07-23 (owner ask): HR now manages every account except owner accounts.
const OWNER_ONLY_TARGET_ROLES = ['owner'];

// Roles a position change may land on: everything creatable, plus the "no role yet"
// placeholder self-registered employees start with.
const ROLE_CHANGE_TARGETS = [...ASSIGNABLE_ROLES, 'not_assign'] as readonly string[];

/**
 * PATCH /api/users/[id] — owner + HR user administration for the /users page (owner ask
 * 2026-07-08). Body may carry { active?: boolean }, { storeIds?: string[] } and/or
 * { role?: string } (position change, owner ask 2026-07-21). Runs with the service role because
 * the profiles/user_stores mutation RLS is owner-only, so the guards here ARE the authorization:
 * owner or HR only, HR may not touch elevated accounts or assign elevated roles, and nobody
 * disables their own login or changes their own role.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });

  const auth = await requireUserAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data: target, error: targetErr } = await service
    .from('profiles')
    .select('id, role')
    .eq('id', id)
    .maybeSingle();
  if (targetErr) return NextResponse.json({ error: 'Failed to load user' }, { status: 500 });
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (target.role === 'customer') {
    return NextResponse.json({ error: 'Customers are not managed here' }, { status: 400 });
  }
  // HR (non-owner) may not administer owner/accountant/hq accounts.
  if (!auth.isOwner && OWNER_ONLY_TARGET_ROLES.includes(target.role as string)) {
    return NextResponse.json({ error: 'Only an owner can manage this account' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    active?: unknown;
    storeIds?: unknown;
    role?: unknown;
  };

  // Change the position (role). Never owner/customer (ROLE_CHANGE_TARGETS excludes both),
  // never your own account. HR may assign/change every non-owner role (owner ask 2026-07-23 —
  // previously elevated roles were owner-only in both directions).
  if (typeof body.role === 'string' && body.role !== target.role) {
    const nextRole = body.role;
    if (!ROLE_CHANGE_TARGETS.includes(nextRole)) {
      return NextResponse.json({ error: `Invalid role '${nextRole}'` }, { status: 400 });
    }
    if (id === auth.userId) {
      return NextResponse.json({ error: 'You cannot change your own position' }, { status: 400 });
    }
    const { error } = await service.from('profiles').update({ role: nextRole }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enable / disable the login.
  if (typeof body.active === 'boolean') {
    if (id === auth.userId && body.active === false) {
      return NextResponse.json({ error: 'You cannot disable your own account' }, { status: 400 });
    }
    const { error } = await service.from('profiles').update({ active: body.active }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Replace store assignments with the given set (add missing, remove extra).
  if (Array.isArray(body.storeIds)) {
    const next = (body.storeIds as unknown[]).filter((s): s is string => typeof s === 'string');
    const { data: cur, error: curErr } = await service
      .from('user_stores')
      .select('store_id')
      .eq('user_id', id);
    if (curErr) return NextResponse.json({ error: curErr.message }, { status: 500 });
    const curSet = new Set((cur ?? []).map((r) => r.store_id as string));
    const nextSet = new Set(next);
    const toAdd = next.filter((s) => !curSet.has(s));
    const toRemove = [...curSet].filter((s) => !nextSet.has(s));
    if (toAdd.length) {
      const { error } = await service
        .from('user_stores')
        .insert(toAdd.map((sid) => ({ user_id: id, store_id: sid })));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (toRemove.length) {
      const { error } = await service
        .from('user_stores')
        .delete()
        .eq('user_id', id)
        .in('store_id', toRemove);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
