const SYSTEM_SETTINGS_ROLES = ['owner', 'hr', 'hq'] as const;
const PERSONAL_SETTINGS_PATHS = ['/settings/account', '/settings/notifications'] as const;

export function canAccessDashboardPath(role: string, pathname: string): boolean {
  const isSettingsPath = pathname === '/settings' || pathname.startsWith('/settings/');
  if (!isSettingsPath) return true;

  const isPersonalSettingsPath = PERSONAL_SETTINGS_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (isPersonalSettingsPath) return true;

  return (SYSTEM_SETTINGS_ROLES as readonly string[]).includes(role);
}
