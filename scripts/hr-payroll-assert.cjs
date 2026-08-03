#!/usr/bin/env node
/**
 * Payroll engine regression assert — runs the PURE `computePayslip` / `progressiveMonthlyTaxSatang`
 * against the hand-computed expected values in docs/hr/P4-EXPECTED.md. No server or DB needed:
 * the engine has no runtime imports, so we transpile it in-process and exercise it directly.
 *
 *   node scripts/hr-payroll-assert.cjs
 *
 * Exit 0 = all pass. This is the offline gate for P4: S1-S4 (core — OT div-8/9, SSO cap,
 * leave salary+travel, late tiers, absent, part-time, progressive/3%/none tax) + S5-S7 (P4.4 —
 * ล.ย.01 allowance, PVD, Tip). Run after any change to src/lib/hr/payroll.ts. Company config =
 * HR Test Co (see the doc header).
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

// ── S1: full-time OT + travel allowance + SC + leave (salary+travel) + late ───
const s1 = slip(
  { rate_satang: 1_800_000, pay_type: 'full_monthly', ot_eligible: true, ot_hour_divisor: 8, tax_mode: 'progressive', sso_enrolled: true },
  {
    ts: { ot_minutes_eligible: 120, late_minutes_per_occurrence: [20] },
    allowances: [{ code: 'travel', label: 'travel', amount_satang: 150_000 }],
    leaves: [{ leave_id: 'L1', label: 'ลากิจ', salary_days: 2, travel_days: 2 }],
    scNetSatang: 500_000,
  },
);
eq('S1 salary', earn(s1, 'salary'), 1_800_000);
eq('S1 ot', earn(s1, 'ot'), 22_500);
eq('S1 allowance travel', earn(s1, 'allowance'), 150_000);
eq('S1 service_charge', earn(s1, 'service_charge'), 500_000);
eq('S1 gross', s1.gross_satang, 2_472_500);
eq('S1 leave_unpaid', ded(s1, 'leave_unpaid'), 120_000);
eq('S1 travel_leave', ded(s1, 'travel_leave'), 10_000);
// 20 min late → tier 2 under the current rule (1–14 ฿50 · 15–29 ฿100 · ≥30 ฿250 max, 2026-07-28)
eq('S1 late (20min → tier2 ฿100)', ded(s1, 'late'), 10_000);
eq('S1 sso (capped)', ded(s1, 'sso'), 87_500);
eq('S1 tax (below bracket)', ded(s1, 'tax'), 0);
// net = gross − deductions − SC: Service Charge is paid as its own transfer (the 15th of the
// following month), so it rides the slip as a reference earning but never the salary net.
eq('S1 net (SC excluded — paid separately)', s1.net_satang, 1_745_000);

// ── S2: div-9 OT, warning wiped SC (SC=0), no salary impact from warning ───────
const s2 = slip(
  { rate_satang: 2_100_000, pay_type: 'full_monthly', ot_eligible: true, ot_hour_divisor: 9, tax_mode: 'progressive', sso_enrolled: true },
  { ts: { ot_minutes_eligible: 180 }, scNetSatang: 0 },
);
eq('S2 ot (div 9)', earn(s2, 'ot'), 35_000);
eq('S2 gross', s2.gross_satang, 2_135_000);
eq('S2 sso (capped)', ded(s2, 'sso'), 87_500);
eq('S2 net', s2.net_satang, 2_047_500);

// ── S3: part-time hourly, 3% withholding, no SSO/OT/SC ─────────────────────────
const s3 = slip(
  { rate_satang: 6_000, pay_type: 'pt_hourly', ot_eligible: false, ot_hour_divisor: 8, tax_mode: 'withholding_3pct', sso_enrolled: false },
  { ts: { worked_days: 0, pt_hours: 80 } },
);
eq('S3 salary (hourly)', earn(s3, 'salary'), 480_000);
eq('S3 sso (none)', ded(s3, 'sso'), 0);
eq('S3 tax 3pct', ded(s3, 'tax'), 14_400);
eq('S3 net', s3.net_satang, 465_600);

// ── S4: unauthorized absent + late tiers + uncapped SSO, tax none ──────────────
const s4 = slip(
  { rate_satang: 900_000, pay_type: 'full_monthly', ot_eligible: false, ot_hour_divisor: 8, tax_mode: 'none', sso_enrolled: true },
  { ts: { unauthorized_absent_days: 1, late_minutes_per_occurrence: [16, 31, 61] } },
);
eq('S4 absent', ded(s4, 'absent'), 30_000);
// [16, 31, 61] min → ฿100 + ฿250 + ฿250 = ฿600 (61 min is CAPPED at ฿250, not 2× per hour)
eq('S4 late (3 tiers, top one capped)', ded(s4, 'late'), 60_000);
eq('S4 sso (uncapped)', ded(s4, 'sso'), 45_000);
eq('S4 net', s4.net_satang, 765_000);

// ── S5: ล.ย.01 progressive tax allowance ──────────────────────────────────────
// ฿50,000 salary + SSO ฿875 → PND1 ฿1,704.17/mo. Matches the client's real payroll sheet
// ("6. Payment June 2026"): SSO tax deduction = actual ฿10,500/yr (875×12), NOT the old ฿9,000 cap.
eq('S5 no-allowance tax', progressiveMonthlyTaxSatang(5_000_000, 87_500, 0), 170_417);
eq('S5 +120k allowance tax', progressiveMonthlyTaxSatang(5_000_000, 87_500, 120_000), 70_417);
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
eq('S6 tax reduced by pvd allowance', ded(sPvd, 'tax'), 155_417);
const sNoPvd = slip({ ...empPvd, pvd_enrolled: false });
eq('S6 net drop = pvd - taxSaving', sNoPvd.net_satang - sPvd.net_satang, 150_000 - (170_417 - 155_417));
eq('S6 part-time no pvd line',
   ded(slip({ ...empPvd, pay_type: 'pt_monthly', sso_enrolled: false }), 'provident_fund'), 0);

// ── S7: Tip pool ────────────────────────────────────────────────────────────────
const empTip = { rate_satang: 5_000_000, pay_type: 'full_monthly', ot_eligible: false, ot_hour_divisor: 8, tax_mode: 'none', sso_enrolled: false };
const sTip = slip(empTip, { tipNetSatang: 2_500_000 });
eq('S7 tip earning', earn(sTip, 'tip'), 2_500_000);
// Tips follow the Service-Charge model: shown on the slip, paid as a separate transfer — so the
// salary net is identical with or without them.
eq('S7 tip NOT in salary net (paid separately)', sTip.net_satang, slip(empTip).net_satang);
eq('S7 part-time gets tip', earn(slip({ ...empTip, pay_type: 'pt_daily', rate_satang: 50_000 }, { tipNetSatang: 100_000, scNetSatang: 999_999 }), 'tip'), 100_000);
eq('S7 part-time no SC', earn(slip({ ...empTip, pay_type: 'pt_daily', rate_satang: 50_000 }, { tipNetSatang: 100_000, scNetSatang: 999_999 }), 'service_charge'), 0);

const fail = results.filter((r) => !r.pass);
for (const r of results) {
  if (!r.pass) console.log(`FAIL ${r.name}: got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`);
}
console.log(`\nHR_PAYROLL_ASSERT = ${results.length - fail.length}/${results.length} ${fail.length ? 'FAILED' : 'ALL PASS'}`);
process.exit(fail.length ? 1 : 0);
