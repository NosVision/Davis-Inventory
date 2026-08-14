import type { UserRole, Permission } from '@/types/roles';
import { ROLE_PERMISSIONS } from '@/types/roles';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  permissions: Permission[];
  storeIds: string[];
  /**
   * Venues this user RUNS (hr_manager_scopes) — a different thing from `storeIds`, which is just
   * where they work. Grants scheduling and leave approval for those venues, and it is a per-user
   * grant rather than a role, so nav gating has to consult it explicitly.
   */
  managedStoreIds: string[];
  /**
   * The same grant split in two (00187): a captain runs the roster and approves nothing, so the
   * nav has to ask which half before showing a module. Optional so anything still reading only
   * `managedStoreIds` keeps working.
   */
  managedScheduleStoreIds?: string[];
  managedApproveStoreIds?: string[];
  lineUserId?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export function hasPermission(user: AuthUser, permission: Permission): boolean {
  const rolePerms = ROLE_PERMISSIONS[user.role];
  if ((rolePerms as string[]).includes('*')) return true;
  return (
    (rolePerms as Permission[]).includes(permission) ||
    user.permissions.includes(permission)
  );
}

export function hasAnyPermission(user: AuthUser, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(user, p));
}

export function hasAllPermissions(user: AuthUser, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(user, p));
}

export function canAccessStore(user: AuthUser, storeId: string): boolean {
  if (user.role === 'owner' || user.role === 'accountant' || user.role === 'hq' || user.role === 'hr') return true;
  return user.storeIds.includes(storeId);
}

export function isDesktopRole(role: UserRole): boolean {
  return ['owner', 'accountant', 'manager', 'hq', 'technician', 'hr', 'cashier'].includes(role);
}

export function isMobileRole(role: UserRole): boolean {
  return ['staff', 'bar', 'head_bar', 'housekeeping_staff', 'boh_staff'].includes(role);
}
