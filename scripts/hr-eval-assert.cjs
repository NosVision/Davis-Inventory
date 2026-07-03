#!/usr/bin/env node
/**
 * Evaluation engine regression assert (P5.1, §G) — pure computeEvalResult + resolveEvalPayout.
 * No server/DB. `node scripts/hr-eval-assert.cjs` (exit 1 on any mismatch). Run after changes
 * to src/lib/hr/evaluation.ts. Values hand-derived from HR-PLAN §G.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'hr', 'evaluation.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { computeEvalResult, resolveEvalPayout } = mod.exports;

const R = [];
const eq = (name, got, want) => R.push({ name, pass: JSON.stringify(got) === JSON.stringify(want), got, want });
const close = (name, got, want) => R.push({ name, pass: Math.abs(got - want) < 1e-9, got, want });

// ── computeEvalResult: average SUBMITTED only, normalize to score_pct ──────────
// two evaluators submit 43 and 39 of 50 → avg 41 → 82%
const r1 = computeEvalResult(
  [{ evaluator_id: 'A', submitted: true, raw_total: 43 }, { evaluator_id: 'B', submitted: true, raw_total: 39 }],
  50,
);
eq('two-evaluator count', r1.evaluator_count, 2);
close('two-evaluator avg', r1.raw_score_avg, 41);
close('two-evaluator pct', r1.score_pct, 82);

// unsubmitted evaluator EXCLUDED from divisor (not counted as 0)
const r2 = computeEvalResult(
  [{ evaluator_id: 'A', submitted: true, raw_total: 40 }, { evaluator_id: 'B', submitted: false, raw_total: 0 }],
  50,
);
eq('unsubmitted excluded → count 1', r2.evaluator_count, 1);
close('unsubmitted excluded → pct 80', r2.score_pct, 80);

// no submissions → null pct (a gap, not 0%)
eq('no submissions → null pct', computeEvalResult([{ evaluator_id: 'A', submitted: false, raw_total: 10 }], 50).score_pct, null);
eq('empty → null pct', computeEvalResult([], 50).score_pct, null);

// max_score 0 → null (can't normalize)
eq('maxScore 0 → null', computeEvalResult([{ evaluator_id: 'A', submitted: true, raw_total: 5 }], 0).score_pct, null);

// pct capped at 100 (raw somehow above max)
close('pct capped 100', computeEvalResult([{ evaluator_id: 'A', submitted: true, raw_total: 60 }], 50).score_pct, 100);

// cross-month comparability: 41/50 and 82/100 → same 82%
close('50-scale', computeEvalResult([{ evaluator_id: 'A', submitted: true, raw_total: 41 }], 50).score_pct, 82);
close('100-scale', computeEvalResult([{ evaluator_id: 'A', submitted: true, raw_total: 82 }], 100).score_pct, 82);

// ── resolveEvalPayout: linear ─────────────────────────────────────────────────
const lin = { formula_type: 'linear', flat_satang: 50_000, satang_per_pct: 1_000 };
eq('linear @ 82%', resolveEvalPayout(lin, 82).amount_satang, 50_000 + 82_000);
eq('linear @ 0%', resolveEvalPayout(lin, 0).amount_satang, 50_000);
eq('linear null score → 0', resolveEvalPayout(lin, null).amount_satang, 0);

// ── resolveEvalPayout: tiered (incl. NEGATIVE = SC deduction, §G↔§H) ──────────
const tiered = {
  formula_type: 'tiered',
  tiers: [
    { id: 't-low', min_pct: 0, max_pct: 49.99, amount_satang: -50_000, label: 'ต่ำ' },  // หัก 500 จาก SC
    { id: 't-mid', min_pct: 50, max_pct: 79.99, amount_satang: -20_000, label: 'ปานกลาง' }, // §G ตัวอย่าง: 50% → หัก 200
    { id: 't-high', min_pct: 80, max_pct: 100, amount_satang: 100_000, label: 'ดี' },
  ],
};
const mid = resolveEvalPayout(tiered, 50); // §G example: avg 5/10 = 50% → หัก 200
eq('tier mid (50%) amount', mid.amount_satang, -20_000);
eq('tier mid matched id', mid.tier_matched_id, 't-mid');
eq('tier high (82%)', resolveEvalPayout(tiered, 82).amount_satang, 100_000);
eq('tier low (30%) deduction', resolveEvalPayout(tiered, 30).amount_satang, -50_000);
eq('tier boundary 49.99 → low', resolveEvalPayout(tiered, 49.99).tier_matched_id, 't-low');
eq('tier boundary 50 → mid', resolveEvalPayout(tiered, 50).tier_matched_id, 't-mid');
eq('tiered null score → 0', resolveEvalPayout(tiered, null).amount_satang, 0);

// gap between tiers (none here) — synthetic: score in an unscored band → 0
const sparse = { formula_type: 'tiered', tiers: [{ id: 'x', min_pct: 90, max_pct: 100, amount_satang: 100_000 }] };
eq('no tier matched → 0', resolveEvalPayout(sparse, 50).amount_satang, 0);
eq('no tier matched → null id', resolveEvalPayout(sparse, 50).tier_matched_id, null);

const fail = R.filter((r) => !r.pass);
for (const r of R) if (!r.pass) console.log(`FAIL ${r.name}: got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`);
console.log(`\nHR_EVAL_ASSERT = ${R.length - fail.length}/${R.length} ${fail.length ? 'FAILED' : 'ALL PASS'}`);
process.exit(fail.length ? 1 : 0);
