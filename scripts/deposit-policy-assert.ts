import assert from 'node:assert/strict';
import { effectiveExpiryISO } from '../src/lib/utils/date';
import { depositExpiryDisplay } from '../src/lib/deposit/expiry-display';
import { hasAcceptedDepositTerms, DEPOSIT_TERMS_VERSION, DEPOSIT_TERMS } from '../src/lib/deposit/terms';

assert.equal(effectiveExpiryISO('2026-09-30T23:59:59+07:00'), '2026-09-30T21:00:00.000Z');
for (const date of ['2026-10-02', '2026-10-03', '2026-10-04']) {
  assert.equal(effectiveExpiryISO(`${date}T23:59:59+07:00`), '2026-10-04T21:00:00.000Z');
}
assert.equal(effectiveExpiryISO('2026-12-31T12:00:00+07:00', []), '2026-12-31T21:00:00.000Z');
const originalNow = Date.now;
try {
  const deposit = { expiry_date: '2026-09-30T23:59:59+07:00', status: 'in_store' };
  Date.now = () => new Date('2026-10-01T03:59:59+07:00').getTime();
  assert.equal(depositExpiryDisplay(deposit).withdrawable, true);
  Date.now = () => new Date('2026-10-01T04:00:00+07:00').getTime();
  assert.equal(depositExpiryDisplay(deposit).state, 'expired');
  assert.equal(depositExpiryDisplay(deposit).withdrawable, false);
  assert.equal(depositExpiryDisplay({ expiry_date: null, status: 'in_store' }).state, 'none');
  assert.equal(depositExpiryDisplay({ expiry_date: null, status: 'expired' }).withdrawable, false);
  assert.equal(depositExpiryDisplay({ expiry_date: '2020-01-01', collection_deadline_at: null, status: 'in_store' }).state, 'none');
  // A stored store-specific extension wins over the default Fri/Sat calculation.
  assert.equal(depositExpiryDisplay({ ...deposit, collection_deadline_at: '2026-10-02T04:00:00+07:00' }).withdrawable, true);
  assert.equal(depositExpiryDisplay({ ...deposit, status: 'pending_withdrawal' }).withdrawable, false);
} finally { Date.now = originalNow; }
for (const locale of ['th', 'en'] as const) {
  assert.equal(DEPOSIT_TERMS[locale].items.length, 6);
  const accepted = { termsAccepted: true, termsVersion: DEPOSIT_TERMS_VERSION, termsLocale: locale };
  assert.equal(hasAcceptedDepositTerms(accepted), true);
  for (const bad of [{}, {...accepted, termsAccepted: false}, {...accepted, termsAccepted: 'true'},
    {...accepted, termsVersion: 'old'}, {...accepted, termsLocale: 'unknown'}]) {
    assert.equal(hasAcceptedDepositTerms(bad), false);
  }
}
console.log('Deposit deadline assertions passed');
