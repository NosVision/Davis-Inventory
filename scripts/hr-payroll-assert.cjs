#!/usr/bin/env node
/**
 * Payroll engine regression assert — runs the PURE `computePayslip` / `progressiveMonthlyTaxSatang`
 * against the hand-computed expected values in docs/hr/P4-EXPECTED.md. No server or DB needed:
 * the engine has no runtime imports, so we transpile it in-process and exercise it directly.
 *
 *   node scripts/hr-payroll-assert.cjs
 *
 * Exit 0 = all pass. This is the offline gate for P4 (S1-S7); run it after any change to
 * src/lib/hr/payroll.ts. Company config = HR Test Co (see the doc header).
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const engPath = path.join(__dirname, '..', 'src', 'lib', 'hr', 'payroll.ts');
const js = ts.transpileModule(fs.readFileSync(engPath, 'utf8'), {
  compilerOptions: { module: 'commonjs', target: 'es2020' },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { computePayslip, progressiveMonthlyTaxSatang } = mod.exports;

const COMPANY = { sso_rate: 0.05, sso_wage_ceiling_satang: 1_750_000, day_divisor: 30, ot1_multiplier: 1.5 };
const results = [];
const eq = (name, got, want) => results.push({ name, pass: got === want, got, want });

function emptyTs(over) {
  return {
    worked_days: 30, pt_hours: 0, ot_minutes_eligible: 0,
    late_minutes_per_occurrence: [], unauthorized_absent_days: 0, ...over,
  };
}
function slip(emp, over) {
  return computePayslip({
    employee: emp, company: COMPANY, timesheet: emptyTs(over?.ts), leaves: over?.leaves ?? [],
    allowances: over?.allowances ?? [], recurringDeductions: over?.recurringDeductions ?? [],
    extraEarnings: over?.extraEarnings ?? [], scNetSatang: over?.scNetSatang ?? 0,
    tipNetSatang: over?.tipNetSatang,
  });
}
const ded = (s, t) => (s.deductions.find((d) => d.type === t) || {}).amount_satang ?? 0;
const earn = (s, t) => (s.earnings.find((e) => e.type === t) || {}).amount_satang ?? 0;

// ── S5: ล.ย.01 progressive tax allowance ──────────────────────────────────────
eq('S5 no-allowance tax', progressiveMonthlyTaxSatang(5_000_000, 87_500, 0), 171_667);
eq('S5 +120k allowance tax', progressiveMonthlyTaxSatang(5_000_000, 87_500, 120_000), 71_667);
eq('S5 +281k allowance → 0', progressiveMonthlyTaxSatang(5_000_000, 87_500, 281_000), 0);
eq('S5 negative allowance clamped', progressiveMonthlyTaxSatang(5_000_000, 87_500, -50_000),
   progressiveMonthlyTaxSatang(5_000_000, 87_500, 0));
eq('S5 default arg === 0', progressiveMonthlyTaxSatang(5_000_000, 87_500),
   progressiveMonthlyTaxSatang(5_000_000, 87_500, 0));

// ── S6: PVD ───────────────────────────────────────────────────────────────────
const empPvd = {
  rate_satang: 5_000_000, pay_type: 'full_monthly', ot_eligible: false, ot_hour_divisor: 8,
  tax_mode: 'progressive', sso_enrolled: true, pvd_enrolled: true, pvd_employee_rate: 0.03,
};
const sPvd = slip(empPvd);
eq('S6 pvd deduction', ded(sPvd, 'provident_fund'), 150_000);
eq('S6 tax reduced by pvd allowance', ded(sPvd, 'tax'), 156_667);
const sNoPvd = slip({ ...empPvd, pvd_enrolled: false });
eq('S6 net drop = pvd - taxSaving', sNoPvd.net_satang - sPvd.net_satang, 150_000 - (171_667 - 156_667));
eq('S6 part-time no pvd line',
   ded(slip({ ...empPvd, pay_type: 'pt_monthly', sso_enrolled: false }), 'provident_fund'), 0);

// ── S7: Tip pool ────────────────────────────────────────────────────────────────
const empTip = { rate_satang: 5_000_000, pay_type: 'full_monthly', ot_eligible: false, ot_hour_divisor: 8, tax_mode: 'none', sso_enrolled: false };
const sTip = slip(empTip, { tipNetSatang: 2_500_000 });
eq('S7 tip earning', earn(sTip, 'tip'), 2_500_000);
eq('S7 tip in net', sTip.net_satang, slip(empTip).net_satang + 2_500_000);
eq('S7 part-time gets tip', earn(slip({ ...empTip, pay_type: 'pt_daily', rate_satang: 50_000 }, { tipNetSatang: 100_000, scNetSatang: 999_999 }), 'tip'), 100_000);
eq('S7 part-time no SC', earn(slip({ ...empTip, pay_type: 'pt_daily', rate_satang: 50_000 }, { tipNetSatang: 100_000, scNetSatang: 999_999 }), 'service_charge'), 0);

const fail = results.filter((r) => !r.pass);
for (const r of results) {
  if (!r.pass) console.log(`FAIL ${r.name}: got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`);
}
console.log(`\nHR_PAYROLL_ASSERT = ${results.length - fail.length}/${results.length} ${fail.length ? 'FAILED' : 'ALL PASS'}`);
process.exit(fail.length ? 1 : 0);
