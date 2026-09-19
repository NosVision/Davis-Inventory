/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test harness. */
// node --test scripts/test-pay-visibility.cjs
//
// The pay-visibility rule (src/lib/hr/pay-visibility.ts) and its SQL twin
// (supabase/migrations/20260919100000_hr_employees_pay_column_grants.sql) must name the same pay
// columns, or one layer hides a figure the other hands out. Pure functions only — no database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');

function loadModule(file) {
  const code = ts.transpileModule(fs.readFileSync(path.resolve(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

const MODULE = 'src/lib/hr/pay-visibility.ts';
const GRANT_MIGRATION = 'supabase/migrations/20260919100000_hr_employees_pay_column_grants.sql';
const VIEW_MIGRATION = 'supabase/migrations/20260919100100_hr_employees_pay_view.sql';

const ALL = { canViewAll: true, managedGroupIds: new Set(), restrictedGroupIds: new Set() };
const visibility = (managed, restricted) => ({
  canViewAll: false,
  managedGroupIds: new Set(managed),
  restrictedGroupIds: new Set(restricted),
});

// ---------------------------------------------------------------------------
// isPayHiddenFrom — the two locks, OR'd
// ---------------------------------------------------------------------------
test('can_view_confidential_pay holders see everyone, flagged or grouped', () => {
  const { isPayHiddenFrom } = loadModule(MODULE);
  assert.equal(isPayHiddenFrom({ pay_confidential: true, payroll_group_id: 'g1' }, ALL), false);
});

test('pay_confidential hides the employee from any caller without the grant', () => {
  const { isPayHiddenFrom } = loadModule(MODULE);
  assert.equal(isPayHiddenFrom({ pay_confidential: true, payroll_group_id: null }, visibility(['g1'], ['g1'])), true);
});

test('a restricted group hides its members from callers who do not manage it', () => {
  const { isPayHiddenFrom } = loadModule(MODULE);
  const v = visibility(['g2'], ['g1', 'g2']);
  assert.equal(isPayHiddenFrom({ pay_confidential: false, payroll_group_id: 'g1' }, v), true);
  assert.equal(isPayHiddenFrom({ pay_confidential: false, payroll_group_id: 'g2' }, v), false);
});

test('an unrestricted group and "no group" are open to any HR user', () => {
  const { isPayHiddenFrom } = loadModule(MODULE);
  const v = visibility([], ['g1']);
  assert.equal(isPayHiddenFrom({ pay_confidential: false, payroll_group_id: 'open' }, v), false);
  assert.equal(isPayHiddenFrom({ pay_confidential: false, payroll_group_id: null }, v), false);
  assert.equal(isPayHiddenFrom({}, v), false);
});

// ---------------------------------------------------------------------------
// redactEmployeePay — every pay column, nothing else
// ---------------------------------------------------------------------------
const fullRow = () => ({
  id: 'e1',
  full_name: 'นายสมชาย ใจดี',
  pay_type: 'full_monthly',
  sso_enrolled: true,
  pay_confidential: true,
  payroll_group_id: null,
  rate_satang: 3_000_000,
  bank_name: 'KBANK',
  bank_account_no: '1234567890',
  bank_account_name: 'สมชาย ใจดี',
  bank_verified: true,
  bank_verified_at: '2026-09-01T00:00:00Z',
  bank_verified_by: 'u1',
  sso_no: '1100000000000',
  tax_id: '1100000000000',
  tax_mode: 'progressive',
  pvd_enrolled: true,
  pvd_employee_rate: 0.03,
  pvd_employer_rate: 0.03,
});

test('a hidden row loses every pay column and gains pay_hidden, keeping the person', () => {
  const { redactEmployeePay, EMPLOYEE_PAY_COLUMNS } = loadModule(MODULE);
  const [out] = redactEmployeePay([fullRow()], visibility([], []));
  for (const col of EMPLOYEE_PAY_COLUMNS) assert.equal(out[col], null, `${col} should be blanked`);
  assert.equal(out.pay_hidden, true);
  assert.equal(out.full_name, 'นายสมชาย ใจดี');
  assert.equal(out.pay_type, 'full_monthly');
  assert.equal(out.sso_enrolled, true);
  assert.equal(out.pay_confidential, true, 'the flag round-trips so the form can save it back');
});

test('the wider redaction covers the statutory ids, tax mode, PVD and bank verification', () => {
  const { EMPLOYEE_PAY_COLUMNS } = loadModule(MODULE);
  for (const col of [
    'sso_no', 'tax_id', 'tax_mode', 'pvd_enrolled', 'pvd_employee_rate', 'pvd_employer_rate',
    'bank_verified', 'bank_verified_at', 'bank_verified_by',
  ]) {
    assert.ok(EMPLOYEE_PAY_COLUMNS.includes(col), `${col} must be a pay column`);
  }
  // Structural, never hidden: they would hide the PERSON.
  assert.ok(!EMPLOYEE_PAY_COLUMNS.includes('pay_type'));
  assert.ok(!EMPLOYEE_PAY_COLUMNS.includes('sso_enrolled'));
  assert.ok(!EMPLOYEE_PAY_COLUMNS.includes('pay_confidential'));
  assert.ok(!EMPLOYEE_PAY_COLUMNS.includes('payroll_group_id'));
});

test('a visible row is returned untouched and the input is never mutated', () => {
  const { redactEmployeePay } = loadModule(MODULE);
  const row = { ...fullRow(), pay_confidential: false };
  const [out] = redactEmployeePay([row], visibility([], []));
  assert.deepEqual(out, row);
  assert.equal(out.pay_hidden, undefined);
  const hidden = fullRow();
  redactEmployeePay([hidden], visibility([], []));
  assert.equal(hidden.rate_satang, 3_000_000, 'input row must not be mutated');
});

test('a caller who may see everything gets a copy of the list with no redaction', () => {
  const { redactEmployeePay } = loadModule(MODULE);
  const rows = [fullRow()];
  const out = redactEmployeePay(rows, ALL);
  assert.notEqual(out, rows);
  assert.deepEqual(out, rows);
});

test('REDACTED_EMPLOYEE_PAY is exactly the pay columns plus the pay_hidden flag', () => {
  const { REDACTED_EMPLOYEE_PAY, EMPLOYEE_PAY_COLUMNS } = loadModule(MODULE);
  assert.deepEqual(
    new Set(Object.keys(REDACTED_EMPLOYEE_PAY)),
    new Set([...EMPLOYEE_PAY_COLUMNS, 'pay_hidden'])
  );
  for (const col of EMPLOYEE_PAY_COLUMNS) assert.equal(REDACTED_EMPLOYEE_PAY[col], null);
  assert.equal(REDACTED_EMPLOYEE_PAY.pay_hidden, true);
});

// ---------------------------------------------------------------------------
// redactBankKeys — the profile-change-request diff
// ---------------------------------------------------------------------------
test('redactBankKeys blanks bank_* keys, keeps the rest, passes null through', () => {
  const { redactBankKeys } = loadModule(MODULE);
  assert.deepEqual(
    redactBankKeys({ bank_name: 'SCB', bank_account_no: '999', bank_account_name: 'x', note: 'keep' }),
    { bank_name: null, bank_account_no: null, bank_account_name: null, note: 'keep' }
  );
  assert.equal(redactBankKeys(null), null);
  assert.equal(redactBankKeys(undefined), undefined);
});

// ---------------------------------------------------------------------------
// TS <-> SQL drift guard
// ---------------------------------------------------------------------------
function readSql(file) {
  return fs.readFileSync(path.resolve(file), 'utf8');
}

/** The `-- PAY_COLUMNS:` marker lines of the grant migration, as a set of column names. */
function migrationPayColumns(sql) {
  const cols = [];
  for (const line of sql.split(/\r?\n/)) {
    const m = line.match(/^--\s*PAY_COLUMNS:\s*(.*)$/);
    if (m) cols.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean));
  }
  return new Set(cols);
}

/** The column list inside `grant select ( ... ) on public.hr_employees to authenticated`. */
function migrationGrantedColumns(sql) {
  const m = sql.match(/grant\s+select\s*\(([^)]*)\)\s*on\s+public\.hr_employees\s+to\s+authenticated/i);
  assert.ok(m, 'grant select (...) on public.hr_employees to authenticated must exist');
  return new Set(m[1].split(',').map((s) => s.trim()).filter(Boolean));
}

test('the grant migration revokes exactly EMPLOYEE_PAY_COLUMNS', () => {
  const { EMPLOYEE_PAY_COLUMNS } = loadModule(MODULE);
  const sql = readSql(GRANT_MIGRATION);
  assert.deepEqual(migrationPayColumns(sql), new Set(EMPLOYEE_PAY_COLUMNS));
  assert.ok(/revoke\s+select\s+on\s+public\.hr_employees\s+from\s+authenticated/i.test(sql));
  const granted = migrationGrantedColumns(sql);
  for (const col of EMPLOYEE_PAY_COLUMNS) {
    assert.ok(!granted.has(col), `${col} is a pay column and must not be granted to authenticated`);
  }
  // The lock's own inputs and the person must stay readable, or the browser roster breaks.
  for (const col of ['id', 'profile_id', 'full_name', 'status', 'end_date', 'pay_confidential', 'payroll_group_id', 'pay_type', 'sso_enrolled']) {
    assert.ok(granted.has(col), `${col} must stay granted`);
  }
});

test('the hr_employees_pay view nulls every pay column and nothing else', () => {
  const { EMPLOYEE_PAY_COLUMNS } = loadModule(MODULE);
  const sql = readSql(VIEW_MIGRATION);
  const nulled = new Set(
    [...sql.matchAll(/case when h\.hidden then null else e\.(\w+)\s+end as (\w+)/g)].map((m) => {
      assert.equal(m[1], m[2], 'view must not rename a pay column');
      return m[1];
    })
  );
  assert.deepEqual(nulled, new Set(EMPLOYEE_PAY_COLUMNS));
  assert.ok(/where public\.can_manage_hr\(\)/.test(sql), 'the view must re-apply the row gate');
});
