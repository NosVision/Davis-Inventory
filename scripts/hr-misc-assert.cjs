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

const HR_LIB_DIR = path.join(__dirname, '..', 'src', 'lib', 'hr');

// Transpile-on-require for sibling .ts files: every hr/*.ts loaded here used to be fully
// self-contained (no local imports), so a bare transpile-and-eval was enough. absence-summary.ts
// imports computeDaySummary/applyOverride from ./time-engine rather than duplicating them — the
// exact "share, don't copy" this plan is about — so this harness now has to resolve that real
// require() too, not just transpile one isolated file. Registered once, globally, for this process
// only; every other `load()` call below is unaffected (plain CommonJS output either way).
require.extensions['.ts'] = (mod, filename) => {
  const src = fs.readFileSync(filename, 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText;
  mod._compile(js, filename);
};

function load(rel) {
  return require(path.join(HR_LIB_DIR, rel));
}

const bt = load('bank-transfer.ts');
const ec = load('eval-config.ts');
const lv = load('leaves.ts');
const wn = load('warnings.ts');
const te = load('time-engine.ts');
const em = load('employees.ts');

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
// Since 00169 the effect is CONFIG-driven (hr_leave_types columns), not derived from `code`.
// TYPES below mirrors the seeded config in production (verified 2026-07-28: identical across all
// 5 companies), so these assertions still pin the §H handbook table end-to-end — if someone edits
// a leave type's flags in a way that breaks the handbook, the mismatch shows up here.
const TYPES = {
  //                       paid,  paid_with_cert, deduct_sc, deduct_travel, requires_cert, cert_threshold_days
  personal: { paid: false, paid_with_cert: false, deduct_sc: true, deduct_travel: true, requires_cert: false, cert_threshold_days: null },
  sick: { paid: false, paid_with_cert: true, deduct_sc: true, deduct_travel: true, requires_cert: true, cert_threshold_days: 3 },
  vacation: { paid: true, paid_with_cert: false, deduct_sc: false, deduct_travel: false, requires_cert: false, cert_threshold_days: null },
  // 'special'/'training'/'marriage'… — paid types that dock nothing
  otherPaid: { paid: true, paid_with_cert: false, deduct_sc: false, deduct_travel: false, requires_cert: false, cert_threshold_days: null },
  // 'unpaid'/'ordination'/'military' — unpaid types treated as an absent day
  otherUnpaid: { paid: false, paid_with_cert: false, deduct_sc: true, deduct_travel: true, requires_cert: false, cert_threshold_days: null },
};
const cle = (key, hasCert) => lv.classifyLeaveEffect(TYPES[key], hasCert);
const ALL_DEDUCTED = { paid: false, deductSalary: true, deductSc: true, deductTravel: true };
const NOTHING_DEDUCTED = { paid: true, deductSalary: false, deductSc: false, deductTravel: false };
eq('leave personal → หักหมด', cle('personal', false), ALL_DEDUCTED);
eq('leave sick no-cert → หักหมด', cle('sick', false), ALL_DEDUCTED);
eq('leave sick +cert → salary ไม่หัก, SC+travel หัก', cle('sick', true), { paid: true, deductSalary: false, deductSc: true, deductTravel: true });
eq('leave vacation → ไม่หักเลย', cle('vacation', false), NOTHING_DEDUCTED);
eq('leave other-paid → ไม่หัก', cle('otherPaid', false), NOTHING_DEDUCTED);
eq('leave other-unpaid → หักหมด', cle('otherUnpaid', false), ALL_DEDUCTED);
// a cert on a type that does NOT grant paid-with-cert changes nothing
eq('leave personal +cert → ยังหักหมด (ไม่มีสิทธิ์ paid_with_cert)', cle('personal', true), ALL_DEDUCTED);
// countLeaveDays excludes holidays
eq('countLeaveDays 5 days no holiday', lv.countLeaveDays('2026-07-01', '2026-07-05', []), 5);
eq('countLeaveDays minus 1 holiday', lv.countLeaveDays('2026-07-01', '2026-07-05', ['2026-07-03']), 4);
// cert required: sick only above its threshold (3); a type with no threshold always needs one
eq('cert sick 3 days → not required', lv.isCertRequired(TYPES.sick, 3), false);
eq('cert sick 4 days → required', lv.isCertRequired(TYPES.sick, 4), true);
eq('cert personal (requires_cert=false) → never required', lv.isCertRequired(TYPES.personal, 10), false);
eq('cert requires_cert + no threshold → always required', lv.isCertRequired({ requires_cert: true, cert_threshold_days: null }, 1), true);
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

// ── time-engine.ts: computeDaySummary / sumDays / applyOverride ──
// worked_min + ot_min are pure spans (TZ-independent); build punches as UTC offsets so the
// numbers are exact regardless of the runner's timezone.
const DAY = '2026-07-01';
const at = (h, m) => `${DAY}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const shift = { start_time: '09:00', end_time: '18:00' };
const baseDay = { businessDate: DAY, shift, isDayOff: false, hasSchedule: true, workHoursPerDay: 8, otEligible: true };

// worked 8h exactly (in 09:00 → out 17:00 UTC = 480 min), no OT
const d8 = te.computeDaySummary({ ...baseDay, punches: [{ type: 'in', ts: at(9, 0) }, { type: 'out', ts: at(17, 0) }] });
eq('te worked 480min', d8.worked_min, 480);
eq('te no OT at exactly 8h', d8.ot_min, 0);
eq('te not absent', d8.absent, false);
eq('te not incomplete', d8.incomplete, false);

// worked 10h eligible → OT 120 (past 8h own hours)
const dOt = te.computeDaySummary({ ...baseDay, punches: [{ type: 'in', ts: at(9, 0) }, { type: 'out', ts: at(19, 0) }] });
eq('te worked 600min', dOt.worked_min, 600);
eq('te OT 120min (eligible, past 8h)', dOt.ot_min, 120);

// same 10h but NOT ot_eligible → no OT
const dNoOt = te.computeDaySummary({ ...baseDay, otEligible: false, punches: [{ type: 'in', ts: at(9, 0) }, { type: 'out', ts: at(19, 0) }] });
eq('te non-eligible → OT 0 even at 10h', dNoOt.ot_min, 0);

// break clipped to worked window: 1h break inside 8h span → worked 420
const dBreak = te.computeDaySummary({ ...baseDay, punches: [
  { type: 'in', ts: at(9, 0) }, { type: 'break_start', ts: at(12, 0) }, { type: 'break_end', ts: at(13, 0) }, { type: 'out', ts: at(17, 0) },
] });
eq('te break 60min', dBreak.break_min, 60);
eq('te worked 420min (8h span − 1h break)', dBreak.worked_min, 420);

// absent: scheduled, no in-punch
const dAbsent = te.computeDaySummary({ ...baseDay, punches: [] });
eq('te absent (scheduled, no in)', dAbsent.absent, true);
eq('te absent worked null', dAbsent.worked_min, null);
// ...but only once the day has CLOSED. A rostered day still ahead of us is not an absence — the
// shift simply hasn't happened, and payroll/SC must not dock salary, travel or Service Charge for
// it (the whole-month-red timesheet + 'Absent (7d)' SC line came from this missing guard).
const dFuture = te.computeDaySummary({ ...baseDay, punches: [], closedThrough: '2026-06-30' });
eq('te future rostered day is NOT absent', dFuture.absent, false);
const dToday = te.computeDaySummary({ ...baseDay, punches: [], closedThrough: DAY });
eq('te absent on the last closed day still counts', dToday.absent, true);
const dPast = te.computeDaySummary({ ...baseDay, punches: [], closedThrough: '2026-07-31' });
eq('te absent on an older closed day still counts', dPast.absent, true);

// incomplete: in but no out
const dInc = te.computeDaySummary({ ...baseDay, punches: [{ type: 'in', ts: at(9, 0) }] });
eq('te incomplete (in, no out)', dInc.incomplete, true);
eq('te incomplete worked null', dInc.worked_min, null);

// day off but punched → worked_on_day_off
const dDayOff = te.computeDaySummary({ ...baseDay, isDayOff: true, punches: [{ type: 'in', ts: at(9, 0) }, { type: 'out', ts: at(13, 0) }] });
eq('te worked_on_day_off', dDayOff.worked_on_day_off, true);
eq('te day-off not scheduled → not absent', dDayOff.absent, false);

// applyOverride: non-null fields win, null falls through, always flags overridden
const ov = te.applyOverride(d8, { worked_min: 300, late_min: null, ot_min: 60, absent: null, reason: 'fix' });
eq('te override worked wins', ov.worked_min, 300);
eq('te override ot wins', ov.ot_min, 60);
eq('te override null late falls through', ov.late_min, d8.late_min);
eq('te override flags overridden', ov.overridden, true);
eq('te override reason', ov.override_reason, 'fix');
eq('te no override → unchanged', te.applyOverride(d8, undefined).worked_min, 480);

// sumDays rollup
const totals = te.sumDays([d8, dOt, dAbsent]);
eq('sumDays work_days (2 with in)', totals.work_days, 2);
eq('sumDays absent_days', totals.absent_days, 1);
eq('sumDays worked_min 480+600', totals.worked_min, 1080);
eq('sumDays ot_min 0+120', totals.ot_min, 120);

// ── employees.ts: pickEmployeeFields (PVD range) + applyPartTimeProfile (forcing) ──
const pk = (body, partial) => em.pickEmployeeFields(body, partial);
eq('pick pvd valid', pk({ pvd_enrolled: true, pvd_employee_rate: 0.03, pvd_employer_rate: 0.05 }, true).ok, true);
eq('pick pvd rate 0.2 rejected', pk({ pvd_employee_rate: 0.2 }, true).ok, false);
eq('pick pvd negative rejected', pk({ pvd_employer_rate: -0.01 }, true).ok, false);
eq('pick pvd 0.15 boundary ok', pk({ pvd_employee_rate: 0.15 }, true).ok, true);
eq('pick pvd string "0.03" coerced', (() => { const r = pk({ pvd_employee_rate: '0.03' }, true); return r.ok && r.fields.pvd_employee_rate; })(), 0.03);
eq('pick omitted pvd absent from fields', 'pvd_enrolled' in pk({ rate_satang: 5000000 }, true).fields, false);
eq('pick bad tax_mode rejected', pk({ tax_mode: 'bogus' }, true).ok, false);
// applyPartTimeProfile: part-time forces withholding_3pct + no SSO/OT
const ptForced = em.applyPartTimeProfile({ pay_type: 'pt_hourly', tax_mode: 'progressive', sso_enrolled: true, ot_eligible: true });
eq('pt forces withholding_3pct', ptForced.tax_mode, 'withholding_3pct');
eq('pt forces sso off', ptForced.sso_enrolled, false);
eq('pt forces ot off', ptForced.ot_eligible, false);
const ftKept = em.applyPartTimeProfile({ pay_type: 'full_monthly', tax_mode: 'progressive', sso_enrolled: true, ot_eligible: true });
eq('full-time keeps tax_mode', ftKept.tax_mode, 'progressive');
eq('full-time keeps sso', ftKept.sso_enrolled, true);

// ── attendance-score: ดัชนีการทำงาน (ESS work index) — bands, penalties, recommendations ──
const as = load('attendance-score.ts');
const base = { scheduledDays: 20, absentDays: 0, lateDays: 0, lateMinutes: 0, incompleteDays: 0, otMinutes: 0 };
eq('score: no scheduled days → null', as.computeAttendanceScore({ ...base, scheduledDays: 0 }), null);
const perfect = as.computeAttendanceScore(base);
eq('score: perfect = 100 excellent', [perfect.overall, perfect.band], [100, 'excellent']);
eq('score: perfect rec', perfect.recommendations.map((r) => r.key), ['perfect']);
const mild = as.computeAttendanceScore({ ...base, lateDays: 1, lateMinutes: 10 });
eq('score: 1 late day → punctuality 88, overall 94, rec lateMild', [mild.components.punctuality, mild.overall, mild.recommendations[0].key], [88, 94, 'lateMild']);
const severe = as.computeAttendanceScore({ ...base, lateDays: 3, lateMinutes: 95 });
eq('score: 3 late/95min → punctuality 49, overall 75 good, rec lateSevere', [severe.components.punctuality, severe.overall, severe.band, severe.recommendations[0].key], [49, 75, 'good', 'lateSevere']);
const abs2 = as.computeAttendanceScore({ ...base, absentDays: 2 });
eq('score: 2 absent → attendance 50, overall 83, rec absent', [abs2.components.attendance, abs2.overall, abs2.recommendations[0].key], [50, 83, 'absent']);
const inc2 = as.computeAttendanceScore({ ...base, incompleteDays: 2 });
eq('score: 2 incomplete → completeness 80, overall 97, rec incomplete', [inc2.components.completeness, inc2.overall, inc2.recommendations[0].key], [80, 97, 'incomplete']);
const ot = as.computeAttendanceScore({ ...base, otMinutes: 660 });
eq('score: high OT appends informational rec (11h)', ot.recommendations.map((r) => r.key).includes('otHigh') && ot.recommendations.find((r) => r.key === 'otHigh').params.hours, 11);
const poor = as.computeAttendanceScore({ ...base, lateDays: 5, lateMinutes: 200, absentDays: 2 });
eq('score: heavy late+absent → overall 38 poor, minute penalty capped', [poor.components.punctuality, poor.overall, poor.band], [10, 38, 'poor']);
eq('score: band boundaries 90/75/60', [as.bandOf(90), as.bandOf(89), as.bandOf(75), as.bandOf(74), as.bandOf(60), as.bandOf(59)], ['excellent', 'good', 'good', 'fair', 'fair', 'poor']);

// ── policy knobs (owner-tunable) — defaults MUST equal historical constants ──
const pol = load('policy.ts');
const pr = load('payroll.ts');
// Client rule 2026-07-28 (all companies): 1–14 → ฿50 · 15–29 → ฿100 · ≥30 → ฿250 CAPPED.
eq('policy: defaults equal the current late-tier rule', pol.POLICY_DEFAULTS.late_tiers, { tier1_satang: 5000, tier2_from_min: 15, tier2_satang: 10000, tier3_from_min: 30, tier3_satang: 25000 });
eq('policy: legacy tier3_satang_per_hour key still maps onto tier3_satang', pol.mergePolicies([{ key: 'late_tiers', value: { tier3_satang_per_hour: 30000 } }]).late_tiers.tier3_satang, 30000);
eq('policy: probation default 119 / sc divisor 30 / carry on', [pol.POLICY_DEFAULTS.probation_days, pol.POLICY_DEFAULTS.sc_leave_divisor, pol.POLICY_DEFAULTS.warning_carry_enabled], [119, 30, true]);
eq('policy: mergePolicies clamps junk to defaults', pol.mergePolicies([{ key: 'probation_days', value: { days: 9999 } }, { key: 'sc_leave_divisor', value: { divisor: 'x' } }]).probation_days, 119);
eq('policy: mergePolicies applies valid overrides', pol.mergePolicies([{ key: 'probation_days', value: { days: 90 } }]).probation_days, 90);
// late fn: every boundary of the current rule (18:00 shift → 18:01/18:14/18:15/18:29/18:30/19:00)
eq('late: 0min → ฿0', pr.lateDeductionForMinutes(0), 0);
eq('late: 1min → ฿50', pr.lateDeductionForMinutes(1), 5000);
eq('late: 14min → ฿50', pr.lateDeductionForMinutes(14), 5000);
eq('late: 15min → ฿100', pr.lateDeductionForMinutes(15), 10000);
eq('late: 29min → ฿100', pr.lateDeductionForMinutes(29), 10000);
eq('late: 30min → ฿250', pr.lateDeductionForMinutes(30), 25000);
eq('late: 60min → ฿250 (capped, NOT per-hour)', pr.lateDeductionForMinutes(60), 25000);
eq('late: 180min → ฿250 (still capped)', pr.lateDeductionForMinutes(180), 25000);
// and it still honours custom tiers
eq('late: custom tier1 ฿70 at 10min', pr.lateDeductionForMinutes(10, { tier1_satang: 7000, tier2_from_min: 15, tier2_satang: 10000, tier3_from_min: 30, tier3_satang: 25000 }), 7000);
eq('late: custom tier2 from 16 → 15min still tier1', pr.lateDeductionForMinutes(15, { tier1_satang: 5000, tier2_from_min: 16, tier2_satang: 12000, tier3_from_min: 30, tier3_satang: 25000 }), 5000);
// probation custom days
eq('probation: custom 30 days', em.computeProbationEnd('2026-01-01', 30), '2026-01-31');
eq('probation: default still 119', em.computeProbationEnd('2026-01-01'), '2026-04-30');
// sc divisor custom
const sc = load('service-charge.ts');
eq('sc leave: default ÷30', sc.computeLeaveScDeduction(3_000_000, 1).amount_satang, 100000);
eq('sc leave: custom ÷26', sc.computeLeaveScDeduction(2_600_000, 1, 26).amount_satang, 100000);
// score custom config: harsher absent penalty + higher band
const asCustom = as.computeAttendanceScore({ scheduledDays: 20, absentDays: 1, lateDays: 0, lateMinutes: 0, incompleteDays: 0, otMinutes: 0 }, { w_punctuality: 50, w_attendance: 35, w_completeness: 15, p_late_day: 12, p_late_30min: 5, p_late_cap: 30, p_absent_day: 50, p_incomplete_day: 10, band_excellent: 95, band_good: 75, band_fair: 60 });
eq('score: custom absent penalty 50 → attendance 50, overall 83 good (band_excellent 95)', [asCustom.components.attendance, asCustom.overall, asCustom.band], [50, 83, 'good']);

// ── 3% withholding basis = GROSS (accountant confirmed 2026-07-06; June sheet R29 San Oo Lwin:
//    470.44 = 3% × Total 15,681.25 incl travel — NOT 3% × base 13,500 = 405) ──
const slip3 = pr.computePayslip({
  employee: { rate_satang: 1_350_000, pay_type: 'full_monthly', ot_eligible: false, ot_hour_divisor: 9, tax_mode: 'withholding_3pct', sso_enrolled: false },
  company: { sso_rate: 0.05, sso_wage_ceiling_satang: 1_750_000, day_divisor: 30, ot1_multiplier: 1.5 },
  timesheet: { worked_days: 30, pt_hours: 0, ot_minutes_eligible: 0, late_minutes_per_occurrence: [], unauthorized_absent_days: 0 },
  leaves: [], allowances: [], recurringDeductions: [],
  extraEarnings: [{ type: 'other', label: 'travel+ot', amount_satang: 218_125, ref: null }],
  scNetSatang: 0,
});
eq('3%% on wage: 13,500 + 2,181.25 extras → tax ฿470.44', slip3.tax_satang, 47044);
eq('3%% on wage: no SSO when not enrolled', slip3.sso_satang, 0);
// SC/tip are customer money — EXCLUDED from the 3% base (Upper workbook: 360 = 3% × 12,000 while
// total incl SC was 25,500). Same person + SC 13,500 → tax unchanged.
const slip3sc = pr.computePayslip({
  employee: { rate_satang: 1_350_000, pay_type: 'full_monthly', ot_eligible: false, ot_hour_divisor: 9, tax_mode: 'withholding_3pct', sso_enrolled: false },
  company: { sso_rate: 0.05, sso_wage_ceiling_satang: 1_750_000, day_divisor: 30, ot1_multiplier: 1.5 },
  timesheet: { worked_days: 30, pt_hours: 0, ot_minutes_eligible: 0, late_minutes_per_occurrence: [], unauthorized_absent_days: 0 },
  leaves: [], allowances: [], recurringDeductions: [],
  extraEarnings: [{ type: 'other', label: 'travel+ot', amount_satang: 218_125, ref: null }],
  scNetSatang: 1_350_000,
});
eq('3%% excludes SC: tax still ฿470.44 with SC 13,500 on the slip', slip3sc.tax_satang, 47044);
eq('3%% excludes SC: gross DOES include SC', slip3sc.gross_satang, 1_350_000 + 218_125 + 1_350_000);

// ── attendance-window.ts: worked time can never be recorded for a day that hasn't closed ──
// The roster legitimately runs weeks ahead (that is how shifts get planned); what must not run
// ahead is anything asserting someone WORKED, was LATE, or was ABSENT.
const aw = load('attendance-window.ts');
eq('aw future date is refused', aw.isFutureAttendanceDate('2026-08-25', '2026-08-06'), true);
eq('aw the last closed day is allowed', aw.isFutureAttendanceDate('2026-08-06', '2026-08-06'), false);
eq('aw a past day is allowed', aw.isFutureAttendanceDate('2026-07-31', '2026-08-06'), false);

// ── sc-line.ts: re-read the MEANING of an SC deduction line stored with an English label ──
// These strings are what recompute wrote into hr_sc_deductions.label before the payslip learned
// to localize them; the parser is the only thing standing between a stored row and a Thai slip.
const sl = load('sc-line.ts');
eq('sc-line warning level', sl.parseScLine({ source_type: 'warning', label: 'Warning: deduct_50' }), { kind: 'warning', level: 'deduct_50' });
eq('sc-line absent days', sl.parseScLine({ source_type: 'absent', label: 'Absent (7d)' }), { kind: 'absent', days: 7 });
eq('sc-line leave code + days', sl.parseScLine({ source_type: 'leave', label: 'Leave: personal (2d)' }), { kind: 'leave', code: 'personal', days: 2 });
eq('sc-line carry family', sl.parseScLine({ source_type: 'stock_penalty_carry', label: 'Stock penalty carry (prev month)' }), { kind: 'carry', family: 'stock_penalty' });
// A human-authored line (HR typed it) is never reinterpreted — it passes through verbatim.
eq('sc-line manual passes through', sl.parseScLine({ source_type: 'manual', label: 'ใบเตือน A-02 (ทดสอบ)' }), { kind: 'raw', text: 'ใบเตือน A-02 (ทดสอบ)' });
// Unparseable/legacy shapes degrade to "no detail" rather than throwing mid-render.
eq('sc-line absent without a count', sl.parseScLine({ source_type: 'absent', label: 'Absent' }), { kind: 'absent', days: null });
eq('sc-line null label', sl.parseScLine({ source_type: 'warning', label: null }), { kind: 'warning', level: null });

// ── pay-visibility.ts: who may see whose pay (§00182 the ลับ flag + §00195 group ownership) ──
// This predicate is the whole access-control story for payroll figures — 14 routes gate on it, and
// the SQL pay_hidden_from_caller() must agree with it exactly. Two locks OR'd, one bypass.
const pv = load('pay-visibility.ts');
const GROUP_A = 'aaaaaaaa-0000-0000-0000-000000000001'; // restricted, owned by our caller
const GROUP_B = 'bbbbbbbb-0000-0000-0000-000000000002'; // restricted, owned by SOMEONE ELSE
const GROUP_OPEN = 'cccccccc-0000-0000-0000-000000000003'; // exists, but nobody owns it
const asManagerOfA = {
  canViewAll: false,
  managedGroupIds: new Set([GROUP_A]),
  restrictedGroupIds: new Set([GROUP_A, GROUP_B]),
};
const plainHr = { canViewAll: false, managedGroupIds: new Set(), restrictedGroupIds: new Set([GROUP_A, GROUP_B]) };
const hidden = (emp, ctx) => pv.isPayHiddenFrom(emp, ctx);

// The bypass: can_view_confidential_pay (owner included) sees everything, both locks notwithstanding.
eq('pv canViewAll beats the ลับ flag', hidden({ pay_confidential: true, payroll_group_id: GROUP_B }, pv.PAY_VISIBILITY_ALL), false);

// Lock 1 — the per-employee ลับ flag, unchanged by this migration.
eq('pv flagged employee is hidden', hidden({ pay_confidential: true, payroll_group_id: null }, plainHr), true);
eq('pv unflagged + ungrouped is visible', hidden({ pay_confidential: false, payroll_group_id: null }, plainHr), false);

// Lock 2 — group ownership. Managing the group is what lifts it, nothing else.
eq('pv own restricted group is visible', hidden({ pay_confidential: false, payroll_group_id: GROUP_A }, asManagerOfA), false);
eq("pv someone else's restricted group is hidden", hidden({ pay_confidential: false, payroll_group_id: GROUP_B }, asManagerOfA), true);
eq('pv plain HR sees neither restricted group', hidden({ pay_confidential: false, payroll_group_id: GROUP_A }, plainHr), true);

// A group with no managers is not a restriction — this is what keeps every pre-00195 group working.
eq('pv unowned group stays open', hidden({ pay_confidential: false, payroll_group_id: GROUP_OPEN }, plainHr), false);

// The locks are OR'd: owning the group does NOT unlock a member who is also flagged ลับ.
eq('pv flag still applies inside your own group', hidden({ pay_confidential: true, payroll_group_id: GROUP_A }, asManagerOfA), true);

// Missing/absent fields must fail OPEN only where that is right: no flag + no group = nothing to hide.
eq('pv empty employee is visible', hidden({}, plainHr), false);

// redactEmployeePay blanks money and marks the row, leaving the person and the true flag value.
const redacted = pv.redactEmployeePay(
  [
    { id: 'e1', full_name: 'ในกลุ่มคนอื่น', rate_satang: 1_800_000, bank_account_no: '1234567890', pay_confidential: false, payroll_group_id: GROUP_B },
    { id: 'e2', full_name: 'กลุ่มของเรา', rate_satang: 2_000_000, bank_account_no: '9999999999', pay_confidential: false, payroll_group_id: GROUP_A },
  ],
  asManagerOfA
);
eq('pv redact blanks the rate of a hidden row', redacted[0].rate_satang, null);
eq('pv redact blanks the bank account of a hidden row', redacted[0].bank_account_no, null);
eq('pv redact keeps the person on the row', redacted[0].full_name, 'ในกลุ่มคนอื่น');
eq('pv redact marks the row for the UI', redacted[0].pay_hidden, true);
eq('pv redact leaves a visible row untouched', redacted[1].rate_satang, 2_000_000);
eq('pv redact does not mark a visible row', redacted[1].pay_hidden, undefined);
// The employee form round-trips the real flag, so redaction must not forge it to true.
eq('pv redact does not forge pay_confidential', redacted[0].pay_confidential, false);

// ── issuer-label.ts: how the company-document issuers read on the payroll-groups screen ──
// The wrong version of this list shipped once — guessed from role in the client, it named an HR
// user who could not issue anything. Owners collapse to one word so a break-glass login is not
// printed on a shared screen.
const il = load('issuer-label.ts');
const owner = (name) => ({ user_id: name, name, nickname: null, implicit: true });
const granted = (name, nick = null) => ({ user_id: name, name, nickname: nick, implicit: false });

eq('issuers: one grantee + owners', il.describeIssuers([granted('ปิยธิดา', 'May'), owner('Tah'), owner('kkd')]), 'ปิยธิดา (May) และเจ้าของระบบ');
eq('issuers: owners only', il.describeIssuers([owner('Tah'), owner('admin_recovery')]), 'เจ้าของระบบ');
eq('issuers: grantees only', il.describeIssuers([granted('ปิยธิดา', 'May'), granted('ชาญชัย')]), 'ปิยธิดา (May), ชาญชัย');
eq('issuers: nobody at all', il.describeIssuers([]), 'ยังไม่มีใคร');
eq('issuers: no nickname prints the bare name', il.describeIssuers([granted('ชาญชัย'), owner('Tah')]), 'ชาญชัย และเจ้าของระบบ');
eq('issuers: english', il.describeIssuers([granted('Piyathida', 'May'), owner('Tah')], false), 'Piyathida (May) and the system owners');

// ── leaves.ts: the annual-quota rule now counts PENDING requests, not just approved ones ──
// Counting only approvals let two requests that each fit be filed back to back and both approved,
// landing the person over quota with nothing having warned anybody.
const lvq = load('leaves.ts');
const VAC = {
  id: 't1', company_id: 'c1', code: 'vacation', name_th: 'ลาพักร้อน', name_en: 'Vacation',
  paid: true, requires_cert: false, requires_reason: true, annual_quota_days: 6,
  max_consecutive_days: null, probational_allowed: true, advance_notice_days: 0,
  cert_threshold_days: null, active: true,
};
const ask = (over) => lvq.validateLeaveRequest({
  leaveType: VAC, fromDate: '2026-09-15', toDate: '2026-09-17', days: 3,
  hasCert: false, today: '2026-09-01', isProbation: false, ...over,
});

eq('quota: room to spare passes', ask({ usedDaysThisYear: 2 }).ok, true);
eq('quota: landing exactly ON the quota passes', ask({ usedDaysThisYear: 3 }).ok, true);
eq('quota: one day past refuses', ask({ usedDaysThisYear: 3.5 }).code, 'quota_exceeded');
// The whole point: approved 2 + pending 3 + this 3 = 8 > 6, though approved alone would have fit.
const withPending = ask({ usedDaysThisYear: 2, pendingThisYear: [{ from_date: '2026-09-15', to_date: '2026-09-17', days: 3 }] });
eq('quota: pending pushes it over', withPending.code, 'quota_exceeded');
eq('quota: breakdown reports the overage', withPending.quota.over, 2);
eq('quota: breakdown separates approved from pending', [withPending.quota.approved, withPending.quota.pending], [2, 3]);
// A type with no quota is unlimited — it must never refuse, however much was taken.
eq('quota: null quota never refuses', ask({ leaveType: { ...VAC, annual_quota_days: null }, usedDaysThisYear: 99 }).ok, true);
// Nothing known about usage → the engine skips the rule rather than guessing zero.
eq('quota: unknown usage skips the rule', ask({}).ok, true);

// The message names the pending request by its dates, because "over quota" against an
// empty-looking calendar is the version people report as a bug.
const msg = lvq.describeQuotaExceeded('ลาพักร้อน', {
  quota: 6, approved: 2, pending: 3, requested: 3, over: 2,
  pendingRefs: [{ from_date: '2026-09-15', to_date: '2026-09-17', days: 3 }],
});
eq('quota msg: states the overage', msg.includes('เกิน 2 วัน'), true);
eq('quota msg: names the pending dates', msg.includes('15–17 ก.ย.'), true);
eq('quota msg: tells them how to proceed', msg.includes('ยกเลิกใบที่รออนุมัติก่อน'), true);
// With nothing pending there is nothing to cancel — do not tell them to cancel it.
const msgNoPending = lvq.describeQuotaExceeded('ลาพักร้อน', { quota: 6, approved: 6, pending: 0, requested: 1, over: 1, pendingRefs: [] });
eq('quota msg: no pending, no cancel advice', msgNoPending.includes('ยกเลิก'), false);
eq('quota msg: single-day range reads as one date', lvq.describeQuotaExceeded('ลากิจ', { quota: 3, approved: 3, pending: 1, requested: 1, over: 2, pendingRefs: [{ from_date: '2026-09-15', to_date: '2026-09-15', days: 1 }] }).includes('(15 ก.ย.)'), true);

// ── employee-name.ts: the name search behind the leave-quota grid ──
// 131 rows is too many to scan, and the surname is usually what people remember — so word order
// must not matter, and a partial match has to be enough.
const en = load('employee-name.ts');
const P = { name: 'สมชาย ใจดี', nickname: 'Aum' };
const hit = (q, who = P) => en.matchesEmployeeSearch(who, q);

eq('search: first name', hit('สมชาย'), true);
eq('search: surname alone', hit('ใจดี'), true);
eq('search: nickname', hit('Aum'), true);
eq('search: nickname is case-insensitive', hit('aum'), true);
eq('search: partial is enough', hit('สมช'), true);
// full_name is one string, so "surname firstname" must work as well as the written order.
eq('search: words in written order', hit('สมชาย ใจดี'), true);
eq('search: words reversed', hit('ใจดี สมชาย'), true);
eq('search: extra spaces are ignored', hit('  ใจดี   สมชาย '), true);
// Every token must land — a stray word means this is not the person being looked for.
eq('search: one token missing = no match', hit('สมชาย สมหญิง'), false);
eq('search: unrelated text', hit('xyz'), false);
// Empty query shows everyone rather than nobody.
eq('search: empty query matches all', hit(''), true);
eq('search: whitespace-only query matches all', hit('   '), true);
// A login with no full_name has the nickname as its name and nothing trailing — must still match.
eq('search: person with no nickname', hit('tan5566', { name: 'tan5566', nickname: null }), true);

// ── schedule-copy.ts: "use the same as last month" for rosters that repeat ──
// Copies by WEEKDAY, not by date: the 1st of one month is a Tuesday and of the next a Friday, so
// copying date-for-date would move everyone's day off.
const sco = load('schedule-copy.ts');
const T = 'tpl-day';
const src = [
  // Sep 2026: 1st = Tuesday. Two Mondays worked, one Monday off → Monday resolves to worked.
  { user_id: 'u1', work_date: '2026-09-07', shift_template_id: T, is_day_off: false },
  { user_id: 'u1', work_date: '2026-09-14', shift_template_id: T, is_day_off: false },
  { user_id: 'u1', work_date: '2026-09-21', shift_template_id: null, is_day_off: true },
  // Every Sunday off.
  { user_id: 'u1', work_date: '2026-09-06', shift_template_id: null, is_day_off: true },
  { user_id: 'u1', work_date: '2026-09-13', shift_template_id: null, is_day_off: true },
];
const plan = sco.buildCopyPlan(src, '2026-10', new Set());
const on = (d) => plan.find((c) => c.work_date === d);

eq('copy: October has 4 Mondays filled', plan.filter((c) => new Date(c.work_date + 'T00:00:00Z').getUTCDay() === 1).length, 4);
eq('copy: Monday takes the majority pattern (worked)', on('2026-10-05').is_day_off, false);
eq('copy: Sunday stays a day off', on('2026-10-04').is_day_off, true);
eq('copy: a weekday never seen in the source is not invented', on('2026-10-06'), undefined);
// Ties go to the later date — the most recent intention wins.
const tie = sco.buildCopyPlan([
  { user_id: 'u2', work_date: '2026-09-01', shift_template_id: T, is_day_off: false },
  { user_id: 'u2', work_date: '2026-09-08', shift_template_id: null, is_day_off: true },
], '2026-10', new Set());
eq('copy: a tie takes the later source date', tie.find((c) => c.work_date === '2026-10-06').is_day_off, true);
// Someone already rostered in the target month is skipped whole — copying must never overwrite.
eq('copy: skips people who already have rows', sco.buildCopyPlan(src, '2026-10', new Set(['u1'])).length, 0);
// Month lengths: February 2027 has 28 days, October 31.
eq('copy: month length 31', sco.monthDates('2026-10').length, 31);
eq('copy: month length 28', sco.monthDates('2027-02').length, 28);
eq('copy: month length 29 in a leap year', sco.monthDates('2028-02').length, 29);

// ── absence-summary.ts: countUnauthorizedAbsentDays — must agree with the payrun POST's own
// unauthorized-absence day count: scheduled ∧ no in-punch ∧ not on approved leave ∧ inside the
// employed window ∧ the day has already closed. Built on time-engine's own computeDaySummary
// (required, not duplicated — see the file's doc comment), so this also pins that the two stay wired
// together correctly.
const asum = load('absence-summary.ts');
const shift9to18 = { start_time: '09:00', end_time: '18:00' };
const schedFull = new Map(
  ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'].map((d) => [
    d,
    { is_day_off: false, shift: shift9to18 },
  ])
);
const absBase = {
  cycleStart: '2026-07-01',
  cycleEnd: '2026-07-05',
  closedThrough: '2026-07-05',
  startDate: null,
  endDate: null,
  scheduleByDate: schedFull,
  punchedDates: new Set(),
  overrideByDate: new Map(),
  leaves: [],
};
eq('absence: 5 scheduled days, no punches, all closed → 5', asum.countUnauthorizedAbsentDays(absBase), 5);
eq(
  'absence: a punched day drops out of the count',
  asum.countUnauthorizedAbsentDays({ ...absBase, punchedDates: new Set(['2026-07-03']) }),
  4
);
eq(
  'absence: an approved-leave day is not unauthorized, even unpunched',
  asum.countUnauthorizedAbsentDays({
    ...absBase,
    punchedDates: new Set(['2026-07-03']),
    leaves: [{ from_date: '2026-07-04', to_date: '2026-07-04' }],
  }),
  3
);
eq(
  'absence: an HR override clearing absent removes that day too',
  asum.countUnauthorizedAbsentDays({
    ...absBase,
    punchedDates: new Set(['2026-07-03']),
    leaves: [{ from_date: '2026-07-04', to_date: '2026-07-04' }],
    overrideByDate: new Map([
      ['2026-07-05', { worked_min: null, late_min: null, ot_min: null, absent: false, reason: 'fix' }],
    ]),
  }),
  2
);
eq(
  'absence: a day past closedThrough is never counted (future rostered day)',
  asum.countUnauthorizedAbsentDays({ ...absBase, closedThrough: '2026-07-02' }),
  2
);
eq(
  'absence: days before the employee\'s start date are excluded',
  asum.countUnauthorizedAbsentDays({ ...absBase, startDate: '2026-07-03' }),
  3
);
eq(
  'absence: a date with no schedule row at all is not "scheduled" → never absent',
  asum.countUnauthorizedAbsentDays({
    cycleStart: '2026-07-01',
    cycleEnd: '2026-07-02',
    closedThrough: '2026-07-02',
    startDate: null,
    endDate: null,
    scheduleByDate: new Map([['2026-07-01', { is_day_off: false, shift: shift9to18 }]]),
    punchedDates: new Set(),
    overrideByDate: new Map(),
    leaves: [],
  }),
  1
);

const fail = R.filter((r) => !r.pass);
for (const r of R) if (!r.pass) console.log(`FAIL ${r.name}: got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`);
console.log(`\nHR_MISC_ASSERT = ${R.length - fail.length}/${R.length} ${fail.length ? 'FAILED' : 'ALL PASS'}`);
process.exit(fail.length ? 1 : 0);
