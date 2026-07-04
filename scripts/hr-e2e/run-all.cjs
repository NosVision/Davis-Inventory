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
  'eval.cjs',          // §G evaluation: seed → 2 evaluators → 2-layer RLS → compute → payout → closed anonymized results
  'eval-money.cjs',    // §G↔payslip: approve route (draft→approved) → positive payout flows to slip eval_bonus
  'eval-apply-sc.cjs', // §G↔§H: negative eval payout → apply-sc → auto SC deduction (idempotent)
  'reports.cjs',       // §J9 statutory reports: ภงด.1/1ก/สปส/50ทวิ/register reconcile + e-filing CSV + HR-only guard
  'scope-payruns.cjs', // §P5.5 T1: per-store scope on payruns family (scoped mgr vs company-wide/cross-store)
  'scope-sc.cjs',      // §P5.5 T1: per-store scope on Service Charge family (pool store_id → requireStoreManager)
  'scope-tip.cjs',     // §P5.5 T1: per-store scope on Tip pool family (mirrors SC)
  'scope-employees.cjs', // §P5.5 T2: per-store scope on employee family (user_stores intersection)
  'scope-offboarding.cjs', // §P5.5 T2: per-store scope on offboarding family + documents (row store_id)
  'scope-time.cjs',    // §P5.5 T3: attendance/override/schedule-ack/warnings-void/dayoff-ack per-store scope
  'scope-assets.cjs',  // §P5.5 T4: locations (per-store geofence) + assets (holder's stores) per-store scope
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
