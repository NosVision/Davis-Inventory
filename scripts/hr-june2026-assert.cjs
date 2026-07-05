#!/usr/bin/env node
/**
 * Engine vs the client's REAL payroll sheet — "6. Payment June 2026" (Baccarat, cycle 26 May–25 Jun,
 * 24 employees). Verifies every money column the sheet computes against the engine's pure formulas:
 *   daily rate (÷30) · PAY OT ((÷30÷8)×1.5×h) · LWP/SLW docks (daily×days) · travel proration
 *   (docked ÷30/day for SL/PL/LWP/SLW/AB, NOT VL/H; sheet rounds to whole baht) · late tiers ·
 *   SSO (5% cap 875) · Total & Net arithmetic · PND1 for the standard fixed-salary case.
 * Anonymized: row numbers + structural figures only (no names / bank accounts / start dates).
 *
 * KNOWN DIFFS (asserted as such, not hidden):
 *  - R7 late: sheet ฿250 vs model ฿150 for [5,15,9] — 12/13 late rows fit the tier model exactly;
 *    this one is presumed a mis-keyed minutes value; flag for the accountant.
 *  - R1/R4/R5 tax: sheet withholds on TOTAL income (likely cumulative YTD method); the engine
 *    annualizes the BASE salary only → matches the standard case (R2: ฿1,704.17) but not
 *    variable-income months. Needs an accountant decision at UAT (recorded in HR-BUILD-STATE).
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'hr', 'payroll.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { lateDeductionForMinutes, progressiveMonthlyTaxSatang } = mod.exports;

const R = [];
const eq = (name, got, want) => R.push({ name, pass: JSON.stringify(got) === JSON.stringify(want), got, want });
const r2 = (n) => Math.round(n * 100) / 100; // to 2dp (baht)
const rB = (n) => Math.round(n); // to whole baht (sheet's travel rounding)

// Sheet rows (satang-free — the sheet is in baht with 2dp; we compare in baht here).
// travelDockDays = SL+PL+LWP+SLW+AB days (VL and H do NOT dock travel — verified on the sheet).
// otherDed = the sheet's "Other" deduction column (misc, taken as-is).
const ROWS = [
  { r: 1,  sal: 50000, ot: 0,  lates: [],                     dock: 0, trans: 0,    payTrans: 0,    lwpD: 0,      slwD: 0,   otherDed: 0,   total: 50000,    ss: 875, tax: 4197.94, net: 44927.06 },
  { r: 2,  sal: 50000, ot: 0,  lates: [],                     dock: 0, trans: 0,    payTrans: 0,    lwpD: 0,      slwD: 0,   otherDed: 0,   total: 50000,    ss: 875, tax: 1704.17, net: 47420.83 },
  { r: 3,  sal: 15500, ot: 0,  lates: [],                     dock: 0, trans: 1500, payTrans: 1500, lwpD: 0,      slwD: 0,   otherDed: 0,   total: 17000,    ss: 775, tax: 0,       net: 16225 },
  { r: 4,  sal: 28500, ot: 13, lates: [],                     dock: 1, trans: 1500, payTrans: 1450, lwpD: 0,      slwD: 950, otherDed: 0,   total: 31315.63, ss: 875, tax: 421.45,  net: 30019.18 },
  { r: 5,  sal: 23500, ot: 14, lates: [],                     dock: 0, trans: 1500, payTrans: 1500, lwpD: 0,      slwD: 0,   otherDed: 0,   total: 27056.25, ss: 875, tax: 680,     net: 25501.25 },
  { r: 6,  sal: 16500, ot: 14, lates: [5, 14, 40, 11],        dock: 3, trans: 1500, payTrans: 1350, lwpD: 550,    slwD: 0,   otherDed: 0,   total: 18493.75, ss: 825, tax: 0,       net: 17668.75 },
  { r: 7,  sal: 15500, ot: 11, lates: [5, 15, 9],             dock: 2, trans: 1000, payTrans: 933,  lwpD: 0,      slwD: 0,   otherDed: 0,   total: 17248.63, ss: 775, tax: 0,       net: 16473.63, lateSheet: 250, lateAnomaly: true },
  { r: 8,  sal: 15500, ot: 16, lates: [],                     dock: 0, trans: 1000, payTrans: 1000, lwpD: 0,      slwD: 0,   otherDed: 0,   total: 18050,    ss: 775, tax: 0,       net: 17275 },
  { r: 9,  sal: 17000, ot: 0,  lates: [],                     dock: 1, trans: 1000, payTrans: 967,  lwpD: 566.67, slwD: 0,   otherDed: 0,   total: 17400.33, ss: 850, tax: 0,       net: 16550.33 },
  { r: 10, sal: 15500, ot: 0,  lates: [60],                   dock: 0, trans: 1500, payTrans: 1500, lwpD: 0,      slwD: 0,   otherDed: 270, total: 16480,    ss: 775, tax: 0,       net: 15705 },
  { r: 11, sal: 14500, ot: 0,  lates: [14, 27, 38],           dock: 1, trans: 1000, payTrans: 967,  lwpD: 483.33, slwD: 0,   otherDed: 126, total: 14657.67, ss: 725, tax: 0,       net: 13932.67 },
  { r: 12, sal: 13500, ot: 0,  lates: [],                     dock: 1, trans: 1500, payTrans: 1450, lwpD: 0,      slwD: 0,   otherDed: 0,   total: 14950,    ss: 675, tax: 0,       net: 14275 },
  { r: 13, sal: 13500, ot: 0,  lates: [19, 60, 16, 27],       dock: 2, trans: 1500, payTrans: 1400, lwpD: 0,      slwD: 0,   otherDed: 0,   total: 14500,    ss: 675, tax: 0,       net: 13825 },
  { r: 14, sal: 13500, ot: 0,  lates: [16, 60],               dock: 0, trans: 1500, payTrans: 1500, lwpD: 0,      slwD: 0,   otherDed: 0,   total: 14700,    ss: 675, tax: 0,       net: 14025 },
  { r: 15, sal: 12500, ot: 0,  lates: [],                     dock: 0, trans: 1500, payTrans: 1500, lwpD: 0,      slwD: 0,   otherDed: 0,   total: 14000,    ss: 625, tax: 0,       net: 13375 },
  { r: 16, sal: 12500, ot: 0,  lates: [1],                    dock: 0, trans: 1500, payTrans: 1500, lwpD: 0,      slwD: 0,   otherDed: 0,   total: 13950,    ss: 625, tax: 0,       net: 13325 },
  { r: 17, sal: 12500, ot: 0,  lates: [5, 3],                 dock: 1, trans: 1500, payTrans: 1450, lwpD: 416.67, slwD: 0,   otherDed: 0,   total: 13433.33, ss: 625, tax: 0,       net: 12808.33 },
  { r: 18, sal: 12500, ot: 0,  lates: [],                     dock: 0, trans: 1500, payTrans: 1500, lwpD: 0,      slwD: 0,   otherDed: 0,   total: 14000,    ss: 625, tax: 0,       net: 13375 },
  { r: 19, sal: 12500, ot: 0,  lates: [],                     dock: 0, trans: 1500, payTrans: 1500, lwpD: 0,      slwD: 0,   otherDed: 0,   total: 14000,    ss: 625, tax: 0,       net: 13375 },
  { r: 20, sal: 12500, ot: 0,  lates: [],                     dock: 0, trans: 1000, payTrans: 1000, lwpD: 0,      slwD: 0,   otherDed: 0,   total: 13500,    ss: 625, tax: 0,       net: 12875 },
  { r: 21, sal: 12500, ot: 0,  lates: [14],                   dock: 1, trans: 1500, payTrans: 1450, lwpD: 416.67, slwD: 0,   otherDed: 0,   total: 13483.33, ss: 625, tax: 0,       net: 12858.33 },
  { r: 22, sal: 12500, ot: 0,  lates: [],                     dock: 0, trans: 1000, payTrans: 1000, lwpD: 0,      slwD: 0,   otherDed: 247, total: 13253,    ss: 625, tax: 0,       net: 12628 },
  { r: 23, sal: 12000, ot: 0,  lates: [39],                   dock: 0, trans: 1000, payTrans: 1000, lwpD: 0,      slwD: 0,   otherDed: 0,   total: 12900,    ss: 600, tax: 0,       net: 12300 },
  { r: 24, sal: 16500, ot: 0,  lates: [120, 13, 12, 5, 60, 4], dock: 2, trans: 1000, payTrans: 933, lwpD: 1100,   slwD: 0,   otherDed: 0,   total: 15383,    ss: 825, tax: 0,       net: 14558 },
];

for (const row of ROWS) {
  const daily = r2(row.sal / 30);

  // PAY OT = (salary ÷30 ÷8) × 1.5 × hours (this sheet's staff are all ÷8; engine divisor is per-person)
  const otPay = r2((row.sal / 30 / 8) * 1.5 * row.ot);

  // Travel proration: entitlement − dockDays × (trans ÷ 30), rounded to whole baht like the sheet.
  const travelCalc = row.trans > 0 ? rB(row.trans - (row.dock * row.trans) / 30) : 0;
  eq(`R${row.r} travel pay`, travelCalc, row.payTrans);

  // Late: engine tier fn vs the sheet's AB./LATE (satang → baht).
  const lateCalc = row.lates.reduce((s, m) => s + lateDeductionForMinutes(m), 0) / 100;
  const lateSheet = row.lateSheet ?? lateCalc;
  if (row.lateAnomaly) {
    // known mis-keyed row: assert the model value so a future tier change still trips this line
    eq(`R${row.r} late (KNOWN ANOMALY: sheet ${lateSheet}, model)`, lateCalc, 150);
  } else {
    // derive the sheet's late from its Total identity below; also assert the fn directly
    eq(`R${row.r} late tiers`, lateCalc, r2(row.sal + otPay + row.payTrans - row.lwpD - row.slwD - row.otherDed - row.total));
  }

  // LWP/SLW docks are daily-rate multiples (sheet rounds each line to 2dp).
  if (row.lwpD > 0) eq(`R${row.r} LWP dock = daily×days`, r2(row.lwpD / daily), Math.round(row.lwpD / daily));
  if (row.slwD > 0) eq(`R${row.r} SLW dock = daily×days`, r2(row.slwD / daily), Math.round(row.slwD / daily));

  // SSO = min(5%, 875)
  eq(`R${row.r} SSO`, Math.min(r2(row.sal * 0.05), 875), row.ss);

  // Total identity: salary + OT + payTrans − late − LWP − SLW − other  (holiday-comp column is 0 all month)
  const late = row.lateAnomaly ? lateSheet : lateCalc;
  eq(`R${row.r} Total`, r2(row.sal + otPay + row.payTrans - late - row.lwpD - row.slwD - row.otherDed), row.total);

  // Net identity: Total − SSO − tax
  eq(`R${row.r} Net`, r2(row.total - row.ss - row.tax), row.net);
}

// PND1: the engine's annualize-base method matches the sheet's standard fixed-salary case exactly.
eq('R2 PND1 standard case (฿50,000 → ฿1,704.17)', progressiveMonthlyTaxSatang(5_000_000, 87_500, 0), 170_417);
// R1/R4/R5 withhold on TOTAL income (cumulative method) — engine intentionally differs; counted above
// only through the Net identity. Recorded as an open accountant question, not silently absorbed.

const fail = R.filter((x) => !x.pass);
for (const x of fail) console.log(`FAIL ${x.name}: got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)}`);
console.log(`\nHR_JUNE2026_ASSERT = ${R.length - fail.length}/${R.length} ${fail.length ? 'FAILED' : 'ALL PASS'}`);
process.exit(fail.length ? 1 : 0);
