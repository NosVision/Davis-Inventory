#!/usr/bin/env node
/**
 * Service Charge deduction assert (P4.1 §H + §G↔§H eval link) — pure compute cores.
 * No server/DB. `node scripts/hr-sc-assert.cjs` (exit 1 on mismatch). Run after changes to
 * src/lib/hr/service-charge.ts. Money in satang.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'hr', 'service-charge.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { computeWarningScDeduction, computeLeaveScDeduction, computeEvalScDeduction, computeNetSc } = mod.exports;

const R = [];
const eq = (name, got, want) => R.push({ name, pass: JSON.stringify(got) === JSON.stringify(want), got, want });

const ALLOC = 1_000_000; // ฿10,000 SC for the month

// ── warnings ──────────────────────────────────────────────────────────────────
eq('warning 50% of alloc', computeWarningScDeduction(ALLOC, { level: 'deduct_50', sc_deduct_percent: 50, amount_satang: null }), { amount_satang: 500_000, carry_satang: 0 });
eq('warning 200% → full + full carry', computeWarningScDeduction(ALLOC, { level: 'deduct_200', sc_deduct_percent: 200, amount_satang: null }), { amount_satang: 1_000_000, carry_satang: 1_000_000 });
eq('warning amount_baht within alloc', computeWarningScDeduction(ALLOC, { level: 'amount_baht', sc_deduct_percent: null, amount_satang: 30_000 }), { amount_satang: 30_000, carry_satang: 0 });
eq('warning amount_baht over alloc → carry', computeWarningScDeduction(ALLOC, { level: 'amount_baht', sc_deduct_percent: null, amount_satang: 1_500_000 }), { amount_satang: 1_000_000, carry_satang: 500_000 });
eq('warning verbal → nothing', computeWarningScDeduction(ALLOC, { level: 'verbal', sc_deduct_percent: null, amount_satang: null }), { amount_satang: 0, carry_satang: 0 });

// ── leave (÷30/day) ─────────────────────────────────────────────────────────────
eq('leave 2 days = 2/30 of alloc', computeLeaveScDeduction(ALLOC, 2), { amount_satang: Math.round(ALLOC * 2 / 30), carry_satang: 0 });
eq('leave 0 days → nothing', computeLeaveScDeduction(ALLOC, 0), { amount_satang: 0, carry_satang: 0 });

// ── eval → SC (§G↔§H): negative payout = deduction, positive = bonus (no SC hit) ──
eq('eval −200 baht → deduct 20000 satang', computeEvalScDeduction(ALLOC, -20_000), { amount_satang: 20_000, carry_satang: 0 });
eq('eval positive (bonus) → no SC deduction', computeEvalScDeduction(ALLOC, 100_000), { amount_satang: 0, carry_satang: 0 });
eq('eval 0 → nothing', computeEvalScDeduction(ALLOC, 0), { amount_satang: 0, carry_satang: 0 });
eq('eval huge deduction over alloc → carry', computeEvalScDeduction(ALLOC, -1_500_000), { amount_satang: 1_000_000, carry_satang: 500_000 });

// ── net SC = alloc − Σ deductions, floored 0 ────────────────────────────────────
eq('net after warning+leave', computeNetSc(ALLOC, [{ amount_satang: 500_000 }, { amount_satang: 66_667 }]), ALLOC - 500_000 - 66_667);
eq('net floored at 0', computeNetSc(ALLOC, [{ amount_satang: 2_000_000 }]), 0);
eq('net ignores negative deduction values', computeNetSc(ALLOC, [{ amount_satang: -50_000 }]), ALLOC);

const fail = R.filter((r) => !r.pass);
for (const r of R) if (!r.pass) console.log(`FAIL ${r.name}: got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`);
console.log(`\nHR_SC_ASSERT = ${R.length - fail.length}/${R.length} ${fail.length ? 'FAILED' : 'ALL PASS'}`);
process.exit(fail.length ? 1 : 0);
