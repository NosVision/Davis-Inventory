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

const fail = R.filter((r) => !r.pass);
for (const r of R) if (!r.pass) console.log(`FAIL ${r.name}: got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`);
console.log(`\nHR_MISC_ASSERT = ${R.length - fail.length}/${R.length} ${fail.length ? 'FAILED' : 'ALL PASS'}`);
process.exit(fail.length ? 1 : 0);
