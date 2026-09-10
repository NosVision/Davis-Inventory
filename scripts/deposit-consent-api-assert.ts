import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/customer/deposit-request/route';
import { DEPOSIT_TERMS_VERSION } from '../src/lib/deposit/terms';

async function main() {
  for (const body of [{}, null, {termsAccepted: false}, {termsAccepted: 'true'},
    {termsAccepted: true, termsVersion: 'old', termsLocale: 'en'}]) {
    const response = await POST(new NextRequest('http://localhost/api/customer/deposit-request', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body),
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'TERMS_REQUIRED');
  }
  // A valid agreement progresses to ordinary validation, without touching the database.
  for (const termsLocale of ['th', 'en']) {
    const response = await POST(new NextRequest('http://localhost/api/customer/deposit-request', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({termsAccepted: true, termsVersion: DEPOSIT_TERMS_VERSION, termsLocale}),
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'Missing storeId');
  }
  console.log('Deposit consent API assertions passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
