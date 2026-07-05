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
  'dashboard.cjs',     // §P5.3 daily dashboard: scoped headcount → checked-in/on-leave/not-in partition + validation
  'emp-history.cjs',   // P1.5 employee salary/position history from audit log (from→to + reason + actor, staff 403)
  'dashboard-alerts.cjs', // P1.5 HR reminders: probation-ending + work-anniversary within window (days_left/years), scope + staff 403
  'overview.cjs',      // §P5.3 dashboard redesign: today+month aggregate feed — partitions (total+per-venue), /daily consistency, trend shape, scope + staff 403
  'sc-carry.cjs',      // §H cross-period SC carry: 200% warning month A → auto warning_carry line month B (recompute), idempotent + control
  'sc-recompute-fixes.cjs', // audit bugs 1-3: recompute preserves eval SC line + carries eval overflow + excludes scheduled day-off from leave SC
  'leave-reason.cjs',  // audit gap #8: requires_reason=false lets a leave be filed without a reason; true rejects 400
  'swap-notify.cjs',   // §Q5 swap flow: file → HR notified → HR approve → schedules exchange + audit + both employees notified
  'employees-link.cjs', // link-existing onboarding: hr_employees attaches to an existing profiles.id (no new account), guards + audit
  'identity-claim.cjs', // identity-claim flow: unlinked user picks their real name → HR notified → approve creates linked employee + audit
  'avatar.cjs',        // P1.5 employee avatar: multipart upload → public bucket + profiles.avatar_url, replace deletes old, type guard + 403 + audit
  'org-chart.cjs',     // P1.5 org chart: scope-aware reporting feed, nesting reflects supervisor_id, staff 403
  'ess-profile.cjs',   // self-service profile: own phone (validated+audited), own avatar, identity fields exposed, anon blocked
  'attendance-index.cjs', // bulk work-index endpoint: score matches pure lib exactly, scope-filtered, invalid range 400, staff 403
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
