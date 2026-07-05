#!/usr/bin/env node
/**
 * Run every committed HR compute-engine regression suite. Offline (no server/DB) — the
 * money-critical math gate for P4/P5. `node scripts/hr-assert-all.cjs` (exit 1 if any suite
 * fails). Add new suites here as engines land.
 */
const { execFileSync } = require('node:child_process');
const path = require('path');

const SUITES = [
  'hr-payroll-assert.cjs',   // P4.2/P4.4 payslip engine (S1-S7)
  'hr-eval-assert.cjs',      // P5.1 evaluation compute + payout + aggregation
  'hr-tax-reports-assert.cjs', // P5.2 ภงด.1/สปส/50ทวิ + P5.4 register/labor-cost
  'hr-sc-assert.cjs',        // P4.1 §H SC deductions + §G↔§H eval bridge
  'hr-misc-assert.cjs',      // bank-transfer (BBL) + eval-config (15-criteria template)
  'hr-june2026-assert.cjs',  // engine vs the client's REAL June 2026 sheet (24 employees, all money columns)
];

let failed = 0;
for (const suite of SUITES) {
  try {
    const out = execFileSync('node', [path.join(__dirname, suite)], { encoding: 'utf8' });
    const line = out.trim().split('\n').filter(Boolean).pop();
    console.log(`✓ ${suite.padEnd(28)} ${line}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${suite.padEnd(28)} FAILED`);
    if (e.stdout) process.stdout.write(e.stdout);
  }
}
console.log(`\nHR_ASSERT_ALL = ${SUITES.length - failed}/${SUITES.length} suites ${failed ? 'FAILED' : 'ALL PASS'}`);
process.exit(failed ? 1 : 0);
