#!/usr/bin/env node
/**
 * Statutory report compute assert (P5.2, §J9) — pure buildPnd1 / buildSso / buildCert50Twi.
 * No server/DB. `node scripts/hr-tax-reports-assert.cjs` (exit 1 on mismatch). Run after
 * changes to src/lib/hr/tax-reports.ts. Values hand-derived; money in satang.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'hr', 'tax-reports.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { buildPnd1, buildSso, buildCert50Twi, buildPayrollRegister, laborCostPct, buildPnd1k, buildPnd1EfilingCsv } = mod.exports;

const R = [];
const eq = (name, got, want) => R.push({ name, pass: JSON.stringify(got) === JSON.stringify(want), got, want });

// slips: E1 has tax + sso; E2 no tax (below bracket) + sso; E3 part-time no tax no sso.
const slips = [
  { employee_id: 'e1', employee_name: 'สมชาย', tax_id: '1101700200111', sso_no: 'S1',
    gross_satang: 2_472_500, tax_satang: 171_667, sso_satang: 87_500, sso_wage_base_satang: 1_800_000 },
  { employee_id: 'e2', employee_name: 'สมหญิง', tax_id: '1101700200222', sso_no: 'S2',
    gross_satang: 2_135_000, tax_satang: 0, sso_satang: 87_500, sso_wage_base_satang: 1_750_000 },
  { employee_id: 'e3', employee_name: 'พาร์ทไทม์', tax_id: null, sso_no: null,
    gross_satang: 480_000, tax_satang: 14_400, sso_satang: 0, sso_wage_base_satang: 0 },
];

// ── ภ.ง.ด.1: only e1 + e3 have tax withheld ───────────────────────────────────
const pnd1 = buildPnd1(slips);
eq('pnd1 line count (tax>0 only)', pnd1.employee_count, 2);
eq('pnd1 excludes zero-tax e2', pnd1.lines.some((l) => l.employee_id === 'e2'), false);
eq('pnd1 total income (e1+e3)', pnd1.total_income_satang, 2_472_500 + 480_000);
eq('pnd1 total tax (e1+e3)', pnd1.total_tax_satang, 171_667 + 14_400);
eq('pnd1 line has tax_id', pnd1.lines[0].tax_id, '1101700200111');

// ── สปส.1-10: only e1 + e2 enrolled (sso>0); employer matches employee ─────────
const sso = buildSso(slips);
eq('sso line count (enrolled only)', sso.employee_count, 2);
eq('sso excludes part-time e3', sso.lines.some((l) => l.employee_id === 'e3'), false);
eq('sso employer matches employee (line)', sso.lines[0].employer_satang, sso.lines[0].employee_satang);
eq('sso total employee', sso.total_employee_satang, 87_500 + 87_500);
eq('sso total employer', sso.total_employer_satang, 87_500 + 87_500);
eq('sso total remit (emp+er)', sso.total_remit_satang, (87_500 + 87_500) * 2);
eq('sso total wage base', sso.total_wage_base_satang, 1_800_000 + 1_750_000);

// ── 50 ทวิ: one employee across 3 months ──────────────────────────────────────
const cert = buildCert50Twi('e1', [
  { employee_id: 'e1', gross_satang: 2_472_500, tax_satang: 171_667, sso_satang: 87_500 },
  { employee_id: 'e1', gross_satang: 2_472_500, tax_satang: 171_667, sso_satang: 87_500 },
  { employee_id: 'e1', gross_satang: 1_800_000, tax_satang: 0, sso_satang: 87_500 },
]);
eq('cert months', cert.months_count, 3);
eq('cert total income', cert.total_income_satang, 2_472_500 * 2 + 1_800_000);
eq('cert total tax', cert.total_tax_satang, 171_667 * 2);
eq('cert total sso', cert.total_sso_satang, 87_500 * 3);
eq('cert empty → zeros', buildCert50Twi('x', []).total_income_satang, 0);

// ── ทะเบียนเงินเดือน / ต้นทุนแรงงาน ───────────────────────────────────────────
const reg = buildPayrollRegister([
  { employee_id: 'e1', employee_name: 'A', gross_satang: 2_472_500, sso_satang: 87_500, tax_satang: 171_667, total_deduction_satang: 222_500, net_satang: 2_250_000 },
  { employee_id: 'e2', employee_name: 'B', gross_satang: 2_135_000, sso_satang: 87_500, tax_satang: 0, total_deduction_satang: 87_500, net_satang: 2_047_500 },
]);
eq('register count', reg.employee_count, 2);
eq('register total gross', reg.total_gross_satang, 2_472_500 + 2_135_000);
eq('register total net', reg.total_net_satang, 2_250_000 + 2_047_500);
eq('register total sso (employee)', reg.total_sso_satang, 175_000);
eq('register employer sso matches', reg.employer_sso_satang, 175_000);
eq('register labor cost = gross + employer sso', reg.total_labor_cost_satang, (2_472_500 + 2_135_000) + 175_000);
eq('register employer pvd defaults 0', reg.employer_pvd_satang, 0);
// employer PVD match joins the labor cost when slips carry pvd_employer_satang
const regPvd = buildPayrollRegister([
  { employee_id: 'e1', employee_name: 'a', gross_satang: 1_000_000, sso_satang: 50_000, tax_satang: 0, total_deduction_satang: 50_000, net_satang: 950_000, pvd_employer_satang: 30_000 },
]);
eq('register employer pvd summed', regPvd.employer_pvd_satang, 30_000);
eq('register labor cost includes employer pvd', regPvd.total_labor_cost_satang, 1_000_000 + 50_000 + 30_000);
// net + deductions must tie to gross per the slips
eq('register ties: net+ded = gross', reg.total_net_satang + reg.total_deduction_satang, reg.total_gross_satang);

// ── %แรงงาน vs ยอดขาย ────────────────────────────────────────────────────────
eq('labor pct 25% (1M cost / 4M sales)', laborCostPct(1_000_000, 4_000_000), 25);
eq('labor pct null on zero sales', laborCostPct(1_000_000, 0), null);
eq('labor pct can exceed 100', laborCostPct(5_000_000, 4_000_000), 125);

// ── ภ.ง.ด.1ก annual (group 12 months per employee; include zero-tax employees) ──
const yearRows = [
  { employee_id: 'e1', employee_name: 'สมชาย', tax_id: '1101700200111', gross_satang: 2_000_000, tax_satang: 100_000 },
  { employee_id: 'e1', employee_name: 'สมชาย', tax_id: '1101700200111', gross_satang: 2_000_000, tax_satang: 100_000 },
  { employee_id: 'e2', employee_name: 'มานะ', tax_id: '1101700200222', gross_satang: 1_500_000, tax_satang: 0 }, // zero-tax still on 1ก
];
const pnd1k = buildPnd1k(yearRows);
eq('1ก groups per employee (2)', pnd1k.employee_count, 2);
eq('1ก e1 months=2', pnd1k.lines.find((l) => l.employee_id === 'e1').months_count, 2);
eq('1ก e1 income summed', pnd1k.lines.find((l) => l.employee_id === 'e1').income_satang, 4_000_000);
eq('1ก includes zero-tax e2', pnd1k.lines.some((l) => l.employee_id === 'e2'), true);
eq('1ก total tax', pnd1k.total_tax_satang, 200_000);
eq('1ก sorted by name (มานะ before สมชาย)', pnd1k.lines[0].employee_name, 'มานะ');

// ── e-filing CSV (baht 2dp, digits-only tax id) ───────────────────────────────
const csv = buildPnd1EfilingCsv([
  { tax_id: '1-1017-00200-11-1', employee_name: 'สมชาย', income_satang: 2_472_500, tax_satang: 171_667 },
]);
const csvLines = csv.split('\r\n');
eq('efiling header', csvLines[0], 'tax_id,employee_name,income_baht,tax_baht');
eq('efiling row (id digits-only, baht 2dp)', csvLines[1], '1101700200111,สมชาย,24725.00,1716.67');
eq('efiling trailing CRLF', csv.endsWith('\r\n'), true);

// ── edge: empty input ─────────────────────────────────────────────────────────
eq('pnd1 empty', buildPnd1([]).employee_count, 0);
eq('sso empty remit', buildSso([]).total_remit_satang, 0);
eq('register empty labor cost', buildPayrollRegister([]).total_labor_cost_satang, 0);
eq('1ก empty', buildPnd1k([]).employee_count, 0);
eq('efiling empty → header only', buildPnd1EfilingCsv([]), 'tax_id,employee_name,income_baht,tax_baht\r\n');

const fail = R.filter((r) => !r.pass);
for (const r of R) if (!r.pass) console.log(`FAIL ${r.name}: got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`);
console.log(`\nHR_TAX_REPORTS_ASSERT = ${R.length - fail.length}/${R.length} ${fail.length ? 'FAILED' : 'ALL PASS'}`);
process.exit(fail.length ? 1 : 0);
