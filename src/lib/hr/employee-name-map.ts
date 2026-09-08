/**
 * Server-side companion to employee-name.ts: resolve a batch of profile ids to
 * ชื่อจริง + ชื่อเล่น in one round trip.
 *
 * hr_leaves / hr_attendance / hr_offboarding and friends all key on profiles.id, and none of them
 * has a direct FK to hr_employees — so every screen that wanted the real name had to join it
 * itself, and most simply didn't. This does the two lookups once and hands back a map.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveEmployeeName, type EmployeeName } from './employee-name';

export interface EmployeeNameEntry extends EmployeeName {
  /** True when an hr_employees row exists — i.e. the person is a real employee, not just a login. */
  linked: boolean;
}

/**
 * profile id → { name, nickname, linked }. Ids with no profile row are simply absent, so callers
 * should keep their own '—' fallback for orphaned references.
 */
export async function buildEmployeeNameMap(
  service: SupabaseClient,
  profileIds: readonly string[]
): Promise<Map<string, EmployeeNameEntry>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  const out = new Map<string, EmployeeNameEntry>();
  if (ids.length === 0) return out;

  const [profRes, empRes] = await Promise.all([
    service.from('profiles').select('id, display_name, username').in('id', ids),
    service.from('hr_employees').select('profile_id, full_name').in('profile_id', ids),
  ]);

  const fullNameById = new Map<string, string>();
  for (const e of (empRes.data ?? []) as { profile_id: string; full_name: string | null }[]) {
    if (e.full_name?.trim()) fullNameById.set(e.profile_id, e.full_name.trim());
  }

  for (const p of (profRes.data ?? []) as {
    id: string;
    display_name: string | null;
    username: string | null;
  }[]) {
    const full = fullNameById.get(p.id) ?? null;
    out.set(p.id, {
      ...resolveEmployeeName({ full_name: full, display_name: p.display_name, username: p.username }),
      linked: !!full,
    });
  }

  return out;
}

/**
 * Add `full_name` to an embedded profile object on each row, keyed off that object's own `id`.
 * For the `user:profiles(id, display_name, username)` embed shape, where the row itself carries
 * no profile id to join on.
 */
export async function attachFullNames<T extends Record<string, unknown>>(
  service: SupabaseClient,
  rows: readonly T[],
  key = 'user'
): Promise<T[]> {
  const embedded = (r: T) => r[key] as { id?: string } | null | undefined;
  const ids = rows.map((r) => embedded(r)?.id).filter((id): id is string => !!id);
  if (ids.length === 0) return [...rows];

  const fullNames = await buildFullNameMap(service, ids);
  return rows.map((r) => {
    const emb = embedded(r);
    if (!emb?.id) return r;
    return { ...r, [key]: { ...emb, full_name: fullNames.get(emb.id) ?? null } };
  });
}

/**
 * Venue + company labels for a manager approval queue (OT / attendance corrections).
 * The request tables carry only `store_id`/`user_id`, so without this the approver sees
 * a bare name and must hunt store-by-store to learn which venue and company each pending
 * request came from. Metadata only — never filters rows, never widens scope.
 */
export interface QueueMeta {
  /** store id → venue display name. */
  storeNameById: Map<string, string>;
  /** requester profile id → employing-company name (via hr_employees.company_id). */
  companyNameByUserId: Map<string, string>;
}

export async function buildQueueMetaMap(
  service: SupabaseClient,
  userIds: readonly string[],
  storeIds: readonly string[]
): Promise<QueueMeta> {
  const users = [...new Set(userIds.filter(Boolean))];
  const stores = [...new Set(storeIds.filter(Boolean))];
  const storeNameById = new Map<string, string>();
  const companyNameByUserId = new Map<string, string>();
  if (users.length === 0 && stores.length === 0) return { storeNameById, companyNameByUserId };

  const [storeRows, empRows] = await Promise.all([
    stores.length > 0
      ? service
          .from('stores')
          .select('id, store_name')
          .in('id', stores)
          .then((r) => (r.data ?? []) as { id: string; store_name: string | null }[])
      : Promise.resolve([] as { id: string; store_name: string | null }[]),
    users.length > 0
      ? service
          .from('hr_employees')
          .select('profile_id, company_id')
          .in('profile_id', users)
          .then((r) => (r.data ?? []) as { profile_id: string; company_id: string | null }[])
      : Promise.resolve([] as { profile_id: string; company_id: string | null }[]),
  ]);

  for (const s of storeRows) {
    if (s.store_name) storeNameById.set(s.id, s.store_name);
  }
  // One profile can hold several employee rows (rehire/move) — first company wins, which is
  // enough for a queue label; the decide routes still gate on the live row.
  const companyIdByUser = new Map<string, string>();
  for (const e of empRows) {
    if (e.company_id && !companyIdByUser.has(e.profile_id)) companyIdByUser.set(e.profile_id, e.company_id);
  }
  const companyIds = [...new Set(companyIdByUser.values())];
  if (companyIds.length > 0) {
    const { data } = await service.from('hr_companies').select('id, name').in('id', companyIds);
    const nameById = new Map(((data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name] as const));
    for (const [profileId, companyId] of companyIdByUser) {
      const name = nameById.get(companyId);
      if (name) companyNameByUserId.set(profileId, name);
    }
  }
  return { storeNameById, companyNameByUserId };
}

/** profile id → full_name only, for routes that already hold their own profiles map. */
export async function buildFullNameMap(
  service: SupabaseClient,
  profileIds: readonly string[]
): Promise<Map<string, string>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;

  const { data } = await service.from('hr_employees').select('profile_id, full_name').in('profile_id', ids);
  for (const e of (data ?? []) as { profile_id: string; full_name: string | null }[]) {
    if (e.full_name?.trim()) out.set(e.profile_id, e.full_name.trim());
  }
  return out;
}
