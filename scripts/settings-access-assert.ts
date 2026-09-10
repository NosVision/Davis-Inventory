import assert from 'node:assert/strict';
import { canAccessDashboardPath } from '../src/lib/auth/settings-access';
import type { UserRole } from '../src/types/roles';

const allowedRoles: UserRole[] = ['owner', 'hr', 'hq'];
const deniedRoles: UserRole[] = [
  'accountant',
  'manager',
  'bar',
  'head_bar',
  'technician',
  'staff',
  'customer',
  'cashier',
  'housekeeping_staff',
  'boh_staff',
  'not_assign',
];

for (const role of allowedRoles) {
  assert.equal(canAccessDashboardPath(role, '/settings'), true, `${role} must access settings`);
  assert.equal(canAccessDashboardPath(role, '/settings/store/store-1'), true, `${role} must access settings children`);
}

for (const role of deniedRoles) {
  assert.equal(canAccessDashboardPath(role, '/settings'), false, `${role} must not access settings`);
  assert.equal(canAccessDashboardPath(role, '/settings/import-deposits'), false, `${role} must not access settings children`);

  assert.equal(canAccessDashboardPath(role, '/settings/account'), true, `${role} must retain personal account access`);
  assert.equal(canAccessDashboardPath(role, '/settings/notifications'), true, `${role} must retain notification access`);
  assert.equal(canAccessDashboardPath(role, '/deposit'), true, `${role} must not be blocked from unrelated routes`);
  assert.equal(canAccessDashboardPath(role, '/settings-preview'), true, `${role} must not match a different route prefix`);
}

console.log('settings access assertions passed');
