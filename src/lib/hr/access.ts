/**
 * HR authorization gate — mirrors the DB `can_manage_hr()` function EXACTLY
 * (owner OR an explicit `can_manage_hr` grant).
 *
 * IMPORTANT: Do NOT use the generic `hasPermission(user, 'can_manage_hr')` for HR
 * routes. `hasPermission` short-circuits to `true` for wildcard roles (owner AND
 * accountant), which would let accountant-role users pass an app-level guard while
 * the DB RLS gate (owner-only + explicit grant) blocks them — a split-brain.
 * Every HR route/page/API guard must use this helper so app-layer and RLS agree.
 *
 * Param is intentionally loose (`role: string`, `permissions: readonly string[]`)
 * so it accepts both `AuthUser` and ad-hoc `{ role, permissions }` looked up in
 * server routes without casts.
 */
export function canManageHr(user: { role: string; permissions: readonly string[] }): boolean {
  return user.role === 'owner' || user.permissions.includes('can_manage_hr');
}
