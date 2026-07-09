// Role scoping for company policies (owner ask 2026-07-09). A policy with no `target_roles`
// (null/empty) applies to EVERYONE — the original handbook behaviour. When target_roles is set
// (e.g. the Stock SOP → ['bar','head_bar']), only those roles see it / are nudged to accept it.
// Single source of truth so the ESS list and the /me badge count never drift.
export function policyAppliesToRole(
  targetRoles: string[] | null | undefined,
  role: string | null | undefined
): boolean {
  if (!targetRoles || targetRoles.length === 0) return true;
  return !!role && targetRoles.includes(role);
}
