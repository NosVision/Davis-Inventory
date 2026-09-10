import assert from 'node:assert/strict';

import {
  DEPOSIT_HISTORY_ACTIONS,
  DEPOSIT_HISTORY_PAGE_SIZE,
  canAccessDepositHistory,
  getChangedFields,
  getDepositHistorySummary,
  parseDepositHistoryQuery,
} from '../src/lib/deposit/history';
import { getAccessibleModules } from '../src/lib/modules/registry';
import type { AuthUser } from '../src/lib/auth/permissions';
import type { UserRole } from '../src/types/roles';

assert.equal(canAccessDepositHistory('hq'), true);
assert.equal(canAccessDepositHistory('owner'), true);
for (const role of ['hr', 'bar', 'head_bar', 'manager', 'staff', 'accountant', null]) {
  assert.equal(canAccessDepositHistory(role), false, `${role ?? 'null'} must not access HQ deposit history`);
}

function userWithRole(role: UserRole): AuthUser {
  return { id: 'user', username: role, role, permissions: [], storeIds: [], managedStoreIds: [] };
}

const hqModuleIds = getAccessibleModules(userWithRole('hq')).map((module) => module.id);
assert.equal(hqModuleIds.includes('hq-deposit-history'), true);
const warehouseIndex = hqModuleIds.indexOf('hq-warehouse');
assert.deepEqual(
  hqModuleIds.slice(warehouseIndex, warehouseIndex + 2),
  ['hq-warehouse', 'hq-deposit-history'],
  'HQ deposit history must appear immediately after HQ warehouse',
);
const ownerModuleIds = getAccessibleModules(userWithRole('owner')).map((module) => module.id);
assert.equal(ownerModuleIds.includes('hq-deposit-history'), true);
for (const role of ['hr', 'bar', 'manager', 'accountant'] as UserRole[]) {
  assert.equal(
    getAccessibleModules(userWithRole(role)).some((module) => module.id === 'hq-deposit-history'),
    false,
    `${role} must not see HQ deposit history in navigation`,
  );
}

assert.equal(DEPOSIT_HISTORY_PAGE_SIZE, 50);
for (const action of [
  'DEPOSIT_CREATED',
  'DEPOSIT_UPDATED',
  'DEPOSIT_EXPIRY_EXTENDED',
  'DEPOSIT_VIP_CHANGED',
  'WITHDRAWAL_CANCELLED',
  'TRANSFER_CONFIRMED',
  'CRON_DEPOSIT_EXPIRED',
  'CUSTOMER_DEPOSIT_REQUEST_CANCELLED',
]) {
  assert.equal(DEPOSIT_HISTORY_ACTIONS.some((candidate) => candidate === action), true, `${action} must be included`);
}

assert.deepEqual(
  parseDepositHistoryQuery(new URLSearchParams('page=-2&q=%20ABC-001%20&storeId=store-1&action=UNKNOWN')),
  { page: 1, q: 'ABC-001', storeId: 'store-1', action: '', from: '', to: '' },
);
assert.equal(parseDepositHistoryQuery(new URLSearchParams('page=3')).page, 3);
assert.equal(parseDepositHistoryQuery(new URLSearchParams(`q=${'x'.repeat(250)}`)).q.length, 120);

const summary = getDepositHistorySummary({
  record_id: 'deposit-id',
  old_value: { customer_name: 'ลูกค้าเดิม', product_name: 'Old label' },
  new_value: { deposit_code: 'DP-001', customer_name: 'ลูกค้าใหม่', product_name: 'Whisky' },
});
assert.deepEqual(summary, {
  depositCode: 'DP-001',
  customerName: 'ลูกค้าใหม่',
  productName: 'Whisky',
});

assert.deepEqual(
  getChangedFields(
    { status: 'in_store', expiry_date: '2026-09-01', detail: { percent: 100 }, unchanged: true },
    { status: 'expired', expiry_date: null, detail: { percent: 50 }, unchanged: true, reason: 'ครบกำหนด' },
  ),
  [
    { field: 'detail.percent', before: 100, after: 50 },
    { field: 'expiry_date', before: '2026-09-01', after: null },
    { field: 'reason', before: undefined, after: 'ครบกำหนด' },
    { field: 'status', before: 'in_store', after: 'expired' },
  ],
);

console.log('deposit history assertions passed');
