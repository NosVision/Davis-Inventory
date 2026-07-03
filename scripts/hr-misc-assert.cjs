#!/usr/bin/env node
/**
 * Committed regression for pure HR libs that were previously verified only by throwaway asserts:
 *   - bank-transfer.ts  (BBL direct-credit encoding — a real bug lived here once)
 *   - eval-config.ts    (default 15-criteria template + period validation)
 * No server/DB. `node scripts/hr-misc-assert.cjs` (exit 1 on mismatch). Money in satang.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function load(rel) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'hr', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
  return mod.exports;
}

const bt = load('bank-transfer.ts');
const ec = load('eval-config.ts');

const R = [];
const eq = (name, got, want) => R.push({ name, pass: JSON.stringify(got) === JSON.stringify(want), got, want });

// ── bank-transfer: amount encoding, date, bank-code resolution, CSV, skip logic ──
eq('bt satang 1234567 → 12345.67', bt.satangToAmountField(1234567), '12345.67');
eq('bt satang 5 → 0.05', bt.satangToAmountField(5), '0.05');
eq('bt satang 0 → 0.00', bt.satangToAmountField(0), '0.00');
eq('bt date 2026-07-31 → 31072026', bt.toDDMMYYYY('2026-07-31'), '31072026');
eq('bt date malformed → empty', bt.toDDMMYYYY('2026/07/31'), '');
eq('bt code null → BBL 002', bt.resolveBankCode(null), '002');
eq('bt code "Bangkok Bank" → 002 (not KBANK regression)', bt.resolveBankCode('Bangkok Bank'), '002');
eq('bt code KBANK → 004', bt.resolveBankCode('KBANK'), '004');
eq('bt code Thai กสิกร → 004', bt.resolveBankCode('ธนาคารกสิกรไทย'), '004');
eq('bt code 3-digit passthrough', bt.resolveBankCode('014'), '014');
eq('bt code unknown → BBL default', bt.resolveBankCode('Some Random Bank'), '002');
eq('bt acct strip dashes', bt.normalizeAccountNo('123-4-56789-0'), '1234567890');

const built = bt.buildBankTransferCsv(
  [
    { bankCode: '002', accountNo: '1234567890', accountName: 'SOMCHAI', netSatang: 225000000, citizenId: '1101700200111', reference: '202607-E1' },
    { bankCode: '002', accountNo: '', accountName: 'NO ACCT', netSatang: 5000000, reference: 'x' }, // skipped
    { bankCode: '002', accountNo: '9', accountName: 'ZERO', netSatang: 0, reference: 'y' }, // skipped
  ],
  { payDate: '2026-07-31' },
);
eq('bt csv count 1 payable', built.count, 1);
eq('bt csv skipped 2', built.skipped.length, 2);
eq('bt csv total = 225000000', built.totalSatang, 225000000);
eq('bt csv header', built.csv.split('\r\n')[0], 'receiving_bank_code,receiving_account_no,receiving_account_name,amount,citizen_id,reference,email,mobile');
eq('bt csv row', built.csv.split('\r\n')[1], '002,1234567890,SOMCHAI,2250000.00,1101700200111,202607-E1,,');

// ── eval-config: default template + period validation ──
eq('ec 15 default criteria', ec.DEFAULT_EVAL_CRITERIA.length, 15);
eq('ec max_score 150', ec.sumMaxScore([...ec.DEFAULT_EVAL_CRITERIA]), 150);
eq('ec sort 1-based', ec.DEFAULT_EVAL_CRITERIA[0].sort_order, 1);
eq('ec period valid', ec.parseEvalPeriod({ period_month: '2026-07-01', title: 'ก.ค.' }).ok, true);
eq('ec period bad month → false', ec.parseEvalPeriod({ period_month: '2026-07-15', title: 'x' }).ok, false);
eq('ec period no title → false', ec.parseEvalPeriod({ period_month: '2026-07-01', title: '' }).ok, false);
eq('ec scope defaults company', ec.parseEvalPeriod({ period_month: '2026-07-01', title: 'x' }).fields.scope_type, 'company');
eq('ec scope stores honored', ec.parseEvalPeriod({ period_month: '2026-07-01', title: 'x', scope_type: 'stores' }).fields.scope_type, 'stores');

const fail = R.filter((r) => !r.pass);
for (const r of R) if (!r.pass) console.log(`FAIL ${r.name}: got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`);
console.log(`\nHR_MISC_ASSERT = ${R.length - fail.length}/${R.length} ${fail.length ? 'FAILED' : 'ALL PASS'}`);
process.exit(fail.length ? 1 : 0);
