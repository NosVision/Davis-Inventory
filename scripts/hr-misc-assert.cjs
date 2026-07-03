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
const lv = load('leaves.ts');
const wn = load('warnings.ts');

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

// ── leaves.ts: §H classifyLeaveEffect (the 3-column pay-effect) + countLeaveDays + cert ──
const cle = (code, paid, hasCert) => lv.classifyLeaveEffect({ code, paid }, hasCert);
eq('leave personal → หักหมด', cle('personal', false, false), { paid: false, deductSalary: true, deductSc: true, deductTravel: true });
eq('leave sick no-cert → หักหมด', cle('sick', false, false), { paid: false, deductSalary: true, deductSc: true, deductTravel: true });
eq('leave sick +cert → salary ไม่หัก, SC+travel หัก', cle('sick', false, true), { paid: true, deductSalary: false, deductSc: true, deductTravel: true });
eq('leave vacation → ไม่หักเลย', cle('vacation', true, false), { paid: true, deductSalary: false, deductSc: false, deductTravel: false });
eq('leave other-paid → ไม่หัก', cle('other', true, false), { paid: true, deductSalary: false, deductSc: false, deductTravel: false });
eq('leave other-unpaid → หักหมด', cle('other', false, false), { paid: false, deductSalary: true, deductSc: true, deductTravel: true });
// countLeaveDays excludes holidays
eq('countLeaveDays 5 days no holiday', lv.countLeaveDays('2026-07-01', '2026-07-05', []), 5);
eq('countLeaveDays minus 1 holiday', lv.countLeaveDays('2026-07-01', '2026-07-05', ['2026-07-03']), 4);
// cert required: sick > 3 days only; others when requires_cert
eq('cert sick 3 days → not required', lv.isCertRequired({ code: 'sick', requires_cert: true }, 3), false);
eq('cert sick 4 days → required', lv.isCertRequired({ code: 'sick', requires_cert: true }, 4), true);
eq('cert non-sick requires_cert → always', lv.isCertRequired({ code: 'personal', requires_cert: true }, 1), true);
eq('cert requires_cert=false → never', lv.isCertRequired({ code: 'sick', requires_cert: false }, 10), false);

// ── warnings.ts: deriveScEffect (server-side SC intent) ──
eq('warn verbal → no SC', wn.deriveScEffect('verbal', null), { ok: true, sc_deduct_percent: null, amount_satang: null, sc_deduct_cycles: 0 });
eq('warn deduct_50 → 50% 1 cycle', wn.deriveScEffect('deduct_50', null), { ok: true, sc_deduct_percent: 50, amount_satang: null, sc_deduct_cycles: 1 });
eq('warn deduct_200 → 200% 2 cycles (carry)', wn.deriveScEffect('deduct_200', null), { ok: true, sc_deduct_percent: 200, amount_satang: null, sc_deduct_cycles: 2 });
eq('warn amount_baht valid', wn.deriveScEffect('amount_baht', 30000), { ok: true, sc_deduct_percent: null, amount_satang: 30000, sc_deduct_cycles: 1 });
eq('warn amount_baht rejects 0', wn.deriveScEffect('amount_baht', 0).ok, false);
eq('warn amount_baht rejects over ฿1M', wn.deriveScEffect('amount_baht', 100_000_001).ok, false);
eq('warn percent-level forces amount null', wn.deriveScEffect('deduct_25', 99999).amount_satang, null);

const fail = R.filter((r) => !r.pass);
for (const r of R) if (!r.pass) console.log(`FAIL ${r.name}: got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`);
console.log(`\nHR_MISC_ASSERT = ${R.length - fail.length}/${R.length} ${fail.length ? 'FAILED' : 'ALL PASS'}`);
process.exit(fail.length ? 1 : 0);
