/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test harness. */
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

const COMPANY = { sso_rate: 0.05, sso_wage_ceiling_satang: 1_750_000, day_divisor: 30, ot1_multiplier: 1.5, wht_rate: 0.03 };
const EMPLOYEE = { rate_satang: 3_000_000, pay_type: 'full_monthly', ot_eligible: false, ot_hour_divisor: 9, tax_mode: 'none', sso_enrolled: false };
const TIMESHEET = { worked_days: 22, pt_hours: 0, ot_minutes_eligible: 0, late_minutes_per_occurrence: [], unauthorized_absent_days: 0, prorate_days: null };

test('a new leave type docks travel by default unless it is vacation / public_holiday (client rule 2026-07-20)', () => {
  const { collectLeaveTypeFields } = loadModule('src/lib/hr/leave-types.ts');
  const bereavement = collectLeaveTypeFields({ code: 'bereavement', name_th: 'ลางานศพ', name_en: 'Bereavement', paid: true }, true);
  assert.equal(bereavement.ok, true);
  assert.equal(bereavement.fields.deduct_travel, true, 'paid special leave still docks travel');
  assert.equal(bereavement.fields.deduct_sc, false, 'SC default still follows paid');

  const vacation = collectLeaveTypeFields({ code: 'vacation', name_th: 'ลาพักร้อน', name_en: 'Vacation', paid: true }, true);
  assert.equal(vacation.fields.deduct_travel, false);
  const ph = collectLeaveTypeFields({ code: 'public_holiday', name_th: 'นักขัตฤกษ์', name_en: 'PH', paid: true }, true);
  assert.equal(ph.fields.deduct_travel, false);

  const explicit = collectLeaveTypeFields({ code: 'special', name_th: 'x', name_en: 'x', paid: true, deduct_travel: false }, true);
  assert.equal(explicit.fields.deduct_travel, false, 'an explicit flag is never overridden');
});

test('classifyLeaveEffect keeps travel independent of paid', () => {
  const { classifyLeaveEffect } = loadModule('src/lib/hr/leaves.ts');
  const paidButDocksTravel = classifyLeaveEffect({ paid: true, paid_with_cert: false, deduct_sc: false, deduct_travel: true }, false);
  assert.deepEqual(paidButDocksTravel, { paid: true, deductSalary: false, deductSc: false, deductTravel: true });
});

test('summarizeLeaveDays groups by type AND effect, keeps leaves that dock nothing, drops zero-day ones', () => {
  const { summarizeLeaveDays } = loadModule('src/lib/hr/payroll.ts');
  const out = summarizeLeaveDays([
    { leave_id: 'a', label: 'sick', salary_days: 1, travel_days: 1, days: 1, name_th: 'ลาป่วย', name_en: 'Sick' },
    { leave_id: 'b', label: 'sick', salary_days: 0, travel_days: 2, days: 2, name_th: 'ลาป่วย', name_en: 'Sick' },
    { leave_id: 'c', label: 'sick', salary_days: 0, travel_days: 1, days: 1, name_th: 'ลาป่วย', name_en: 'Sick' },
    { leave_id: 'd', label: 'vacation', salary_days: 0, travel_days: 0, days: 3, name_th: 'ลาพักร้อน', name_en: 'Vacation' },
    { leave_id: 'e', label: 'vacation', salary_days: 0, travel_days: 0, days: 0 },
  ]);
  assert.deepEqual(out, [
    { code: 'sick', name_th: 'ลาป่วย', name_en: 'Sick', days: 1, deduct_salary: true, deduct_travel: true, deduct_sc: false },
    { code: 'sick', name_th: 'ลาป่วย', name_en: 'Sick', days: 3, deduct_salary: false, deduct_travel: true, deduct_sc: false },
    { code: 'vacation', name_th: 'ลาพักร้อน', name_en: 'Vacation', days: 3, deduct_salary: false, deduct_travel: false, deduct_sc: false },
  ]);
});

test('computePayslip: a paid leave with deduct_travel docks travel ÷30 per day, no salary line, and appears in leave_summary', () => {
  const { computePayslip } = loadModule('src/lib/hr/payroll.ts');
  const slip = computePayslip({
    employee: EMPLOYEE,
    company: COMPANY,
    timesheet: TIMESHEET,
    leaves: [{ leave_id: 'x', label: 'bereavement', salary_days: 0, travel_days: 2, days: 2, name_th: 'ลางานศพ', name_en: 'Bereavement' }],
    allowances: [{ code: 'travel', label: 'ค่าเดินทาง', amount_satang: 300_000 }],
    recurringDeductions: [],
    extraEarnings: [],
    scNetSatang: 0,
  });
  const travel = slip.deductions.find((d) => d.type === 'travel_leave');
  assert.ok(travel, 'travel docked');
  assert.equal(travel.amount_satang, 20_000); // 3,000 ÷ 30 × 2 days = ฿200
  assert.equal(slip.deductions.some((d) => d.type === 'leave_unpaid'), false, 'salary untouched');
  assert.equal(slip.net_satang, 3_000_000 + 300_000 - 20_000);
  assert.deepEqual(slip.leave_summary, [
    { code: 'bereavement', name_th: 'ลางานศพ', name_en: 'Bereavement', days: 2, deduct_salary: false, deduct_travel: true, deduct_sc: false },
  ]);
});

test('computePayslip: a leave with no money effect emits no line but is still in leave_summary', () => {
  const { computePayslip } = loadModule('src/lib/hr/payroll.ts');
  const slip = computePayslip({
    employee: EMPLOYEE,
    company: COMPANY,
    timesheet: TIMESHEET,
    leaves: [{ leave_id: 'y', label: 'vacation', salary_days: 0, travel_days: 0, days: 3, name_th: 'ลาพักร้อน', name_en: 'Vacation' }],
    allowances: [],
    recurringDeductions: [],
    extraEarnings: [],
    scNetSatang: 0,
  });
  assert.equal(slip.deductions.length, 0);
  assert.equal(slip.net_satang, 3_000_000);
  assert.equal(slip.leave_summary.length, 1);
  assert.equal(slip.leave_summary[0].days, 3);
});
