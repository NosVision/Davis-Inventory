import { createClient, createServiceClient } from '@/lib/supabase/server';
import { canManageHr } from '@/lib/hr/access';

export type HrAuthResult =
  | {
      ok: true;
      userId: string;
      role: string;
      /** true when the caller passed via company-wide HR (owner / can_manage_hr); false when they
       *  passed only via a store scope (hr_manager_scopes). Lets money routes apply stricter rules
       *  to scoped managers (e.g. the self-dealing block on payroll adjustments). */
      fullHr: boolean;
    }
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
  return { ok: true, userId: user.id, role, fullHr: true };
}

/**
 * Auth + authorization for STORE-SCOPED management (scheduling §C). Grants access to a
 * caller who is company-wide HR (owner / can_manage_hr) OR a manager scoped to THIS
 * store (`hr_manager_scopes`). Mirrors the SQL `can_manage_store()` used by RLS so the
 * app and the database agree. A manager must never manage a store outside their scope.
 */
export async function requireStoreManager(storeId: string): Promise<HrAuthResult> {
  if (!storeId) return { ok: false, error: 'store_id is required', status: 400 };

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
    console.error('requireStoreManager: auth lookup failed', {
      profileErr: profileRes.error?.message,
      permsErr: permsRes.error?.message,
    });
    return { ok: false, error: 'authorization check failed', status: 503 };
  }

  const role = (profileRes.data?.role as string) ?? '';
  const permissions = (permsRes.data ?? []).map((p) => p.permission as string);

  // Company-wide HR may manage any store's schedule.
  if (canManageHr({ role, permissions })) return { ok: true, userId: user.id, role, fullHr: true };

  // Otherwise the caller must be a manager scoped to this specific store.
  const service = createServiceClient();
  const { data: scope, error: scopeErr } = await service
    .from('hr_manager_scopes')
    .select('id')
    .eq('user_id', user.id)
    .eq('store_id', storeId)
    .maybeSingle();
  if (scopeErr) {
    console.error('requireStoreManager: scope lookup failed', scopeErr.message);
    return { ok: false, error: 'authorization check failed', status: 503 };
  }
  if (!scope) {
    return { ok: false, error: 'Forbidden — not a manager of this store', status: 403 };
  }
  return { ok: true, userId: user.id, role, fullHr: false };
}

/**
 * Auth for SCHEDULING a specific roster scope (owner change 2026-08-07).
 *
 * The venue's own manager now builds their store's roster; HQ/HR keep company-wide reach.
 *   • store scope  → hq / HR / owner, OR a manager scoped to THAT store (hr_manager_scopes)
 *   • company scope → hq / HR / owner only. Company rosters reach staff with no venue
 *     (housekeeping, technicians, the not-yet-assigned), who have no manager to own them —
 *     so they stay with HR exactly as before.
 *
 * `storeId = null` means company scope.
 */
export async function requireSchedulerForScope(storeId: string | null): Promise<HrAuthResult> {
  const base = await requireScheduler();
  if (base.ok) return base;
  // Not HQ/HR — a store roster is still reachable by that store's own manager.
  if (!storeId) return base;
  return requireStoreManager(storeId);
}

/**
 * Company-wide scheduling authority: the HQ scheduler role (`hq`) plus HR/owner. Store managers
 * reach their own store through {@link requireSchedulerForScope}; this is the gate for actions
 * that are not tied to one store (shift templates, company-scope rosters).
 */
export async function requireScheduler(): Promise<HrAuthResult> {
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
    console.error('requireScheduler: auth lookup failed', {
      profileErr: profileRes.error?.message,
      permsErr: permsRes.error?.message,
    });
    return { ok: false, error: 'authorization check failed', status: 503 };
  }

  const role = (profileRes.data?.role as string) ?? '';
  const permissions = (permsRes.data ?? []).map((p) => p.permission as string);
  if (role === 'hq' || canManageHr({ role, permissions })) {
    return { ok: true, userId: user.id, role, fullHr: canManageHr({ role, permissions }) };
  }
  return { ok: false, error: 'Forbidden — requires scheduling access (HQ / HR)', status: 403 };
}

/**
 * Per-store gate for a row that carries a nullable `store_id` (§P5.5). A company-wide row
 * (`store_id IS NULL`, e.g. a company-wide payrun) is full-HR only; a store-scoped row is
 * reachable by company-wide HR OR a manager scoped to that store. Keeps company-HR behaviour
 * identical to `requireHrManager()` while adding scoped-manager access only for their store.
 */
export async function requireHrManagerForStore(storeId: string | null): Promise<HrAuthResult> {
  return storeId ? requireStoreManager(storeId) : requireHrManager();
}

/**
 * Gate a route on the `store_id` of a specific row (§P5.5), for tables that carry a nullable
 * `store_id` (offboarding, timesheet overrides, dayoff swaps, warnings…). Loads the row's store,
 * 404s if the row is missing, then defers to {@link requireHrManagerForStore} (NULL store =
 * company-wide → full HR; a store → that store's manager or company-wide HR).
 */
export async function requireHrManagerForRowStore(table: string, id: string): Promise<HrAuthResult> {
  const service = createServiceClient();
  const { data, error } = await service.from(table).select('store_id').eq('id', id).maybeSingle();
  if (error) return { ok: false, error: 'authorization check failed', status: 503 };
  if (!data) return { ok: false, error: 'Not found', status: 404 };
  return requireHrManagerForStore((data.store_id as string | null) ?? null);
}

/**
 * Per-employee gate for routes keyed by an `hr_employees.id` (§P5.5). Company-wide HR passes for
 * anyone; a store-scoped manager passes only when the employee's `user_stores` intersect the
 * manager's `hr_manager_scopes`. A scoped manager probing an employee outside their stores (or a
 * non-existent id) gets 403 — never a leak of who exists elsewhere.
 */
export async function requireHrManagerForEmployeeId(employeeId: string): Promise<HrAuthResult> {
  return requireHrManagerForEmployee({ employeeId });
}

/**
 * Same gate as {@link requireHrManagerForEmployeeId} but keyed by the employee's `profile_id`
 * directly (for routes that carry the profile/user id rather than the hr_employees.id).
 */
export async function requireHrManagerForEmployeeProfile(profileId: string): Promise<HrAuthResult> {
  return requireHrManagerForEmployee({ profileId });
}

async function requireHrManagerForEmployee(
  key: { employeeId: string } | { profileId: string },
): Promise<HrAuthResult> {
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
    console.error('requireHrManagerForEmployee: auth lookup failed', {
      profileErr: profileRes.error?.message,
      permsErr: permsRes.error?.message,
    });
    return { ok: false, error: 'authorization check failed', status: 503 };
  }
  const role = (profileRes.data?.role as string) ?? '';
  const permissions = (permsRes.data ?? []).map((p) => p.permission as string);
  if (canManageHr({ role, permissions })) return { ok: true, userId: user.id, role, fullHr: true };

  const service = createServiceClient();
  let employeeProfileId: string | null;
  if ('profileId' in key) {
    employeeProfileId = key.profileId;
  } else {
    const { data: emp } = await service.from('hr_employees').select('profile_id').eq('id', key.employeeId).maybeSingle();
    employeeProfileId = (emp?.profile_id as string | undefined) ?? null;
  }
  if (!employeeProfileId) return { ok: false, error: 'Forbidden — employee not in your stores', status: 403 };

  const [empStoresRes, scopesRes] = await Promise.all([
    service.from('user_stores').select('store_id').eq('user_id', employeeProfileId),
    service.from('hr_manager_scopes').select('store_id').eq('user_id', user.id),
  ]);
  if (empStoresRes.error || scopesRes.error) {
    console.error('requireHrManagerForEmployee: scope lookup failed', {
      empErr: empStoresRes.error?.message,
      scopeErr: scopesRes.error?.message,
    });
    return { ok: false, error: 'authorization check failed', status: 503 };
  }
  const scopeSet = new Set((scopesRes.data ?? []).map((s) => s.store_id as string));
  const inScope = (empStoresRes.data ?? []).some((s) => scopeSet.has(s.store_id as string));
  if (!inScope) return { ok: false, error: 'Forbidden — employee not in your stores', status: 403 };
  return { ok: true, userId: user.id, role, fullHr: false };
}

/**
 * Resolve the caller's HR list scope (§P5.5) for list endpoints. `storeIds === null` means the
 * caller is company-wide HR (see everything); an array means a store-scoped manager (see only
 * those stores' rows — company-wide/NULL rows are excluded). A caller who is neither is denied.
 */
export type HrScopeResult =
  | { ok: true; userId: string; storeIds: string[] | null }
  | { ok: false; error: string; status: number };

export async function resolveHrScope(): Promise<HrScopeResult> {
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
    console.error('resolveHrScope: auth lookup failed', {
      profileErr: profileRes.error?.message,
      permsErr: permsRes.error?.message,
    });
    return { ok: false, error: 'authorization check failed', status: 503 };
  }
  const role = (profileRes.data?.role as string) ?? '';
  const permissions = (permsRes.data ?? []).map((p) => p.permission as string);
  if (canManageHr({ role, permissions })) return { ok: true, userId: user.id, storeIds: null };

  const service = createServiceClient();
  const { data: scopes, error: scopeErr } = await service
    .from('hr_manager_scopes')
    .select('store_id')
    .eq('user_id', user.id);
  if (scopeErr) {
    console.error('resolveHrScope: scope lookup failed', scopeErr.message);
    return { ok: false, error: 'authorization check failed', status: 503 };
  }
  const storeIds = (scopes ?? []).map((s) => s.store_id as string);
  if (storeIds.length === 0) return { ok: false, error: 'Forbidden — requires can_manage_hr', status: 403 };
  return { ok: true, userId: user.id, storeIds };
}
