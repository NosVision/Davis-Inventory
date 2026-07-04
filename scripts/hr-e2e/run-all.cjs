#!/usr/bin/env node
/**
 * Run every HR live-auth e2e suite SEQUENTIALLY (they mutate shared test-tenant data, so they
 * must not overlap). Requires a running dev server + the creds file (see lib.cjs header).
 * `node scripts/hr-e2e/run-all.cjs` — exit 1 if any suite fails.
 */
const { execFileSync } = require('node:child_process');
const path = require('path');

const SUITES = [
  'p43.cjs',           // payrun lifecycle: generate → detail → ESS draft-hidden → finalize → self-scoped → 403/409 → reopen
  'tax-allowance.cjs', // ล.ย.01 CRUD → progressive PND1 tax drop (temp taxable rate) → restore
  'bank-file.cjs',     // BBL direct-credit CSV: draft 409 → finalized export headers/total → staff 403
  'pvd.cjs',           // provident_fund deduction line: enroll 3% → net drops by exact amount → disenroll
  'tip-pool.cjs',      // tip pool → alloc → deduction (net) → 'tip' earning line on slip → finalize 409 → staff 403
];

let failed = 0;
for (const suite of SUITES) {
  try {
    const out = execFileSync('node', [path.join(__dirname, suite)], { encoding: 'utf8' });
    const line = out.trim().split('\n').filter(Boolean).pop();
    console.log(`✓ ${suite.padEnd(20)} ${line}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${suite.padEnd(20)} FAILED`);
    if (e.stdout) process.stdout.write(e.stdout);
  }
}
console.log(`\nHR_E2E_ALL = ${SUITES.length - failed}/${SUITES.length} suites ${failed ? 'FAILED' : 'ALL PASS'}`);
process.exit(failed ? 1 : 0);
