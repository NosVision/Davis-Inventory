import assert from 'node:assert/strict';
import { canManageDepositExpiry } from '../src/lib/deposit/expiry-access';
import type { UserRole } from '../src/types/roles';

const roles: UserRole[] = [
  'owner', 'accountant', 'manager', 'bar', 'head_bar', 'technician', 'staff',
  'customer', 'hq', 'hr', 'cashier', 'housekeeping_staff', 'boh_staff', 'not_assign',
];

for (const role of roles) {
  assert.equal(
    canManageDepositExpiry(role),
    role === 'bar',
    `${role} expiry/VIP access must ${role === 'bar' ? 'be allowed' : 'be denied'}`,
  );
}

console.log('deposit expiry/VIP access assertions passed');
