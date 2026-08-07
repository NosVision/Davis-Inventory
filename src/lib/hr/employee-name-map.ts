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
