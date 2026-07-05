// HR Payroll engine (P4.2, §A) — PURE, satang-exact. NO manual override of computed
// money lines (client rule: "ต้องถูกกับเงินเดือน ไม่สามารถใส่ตัวเลขหักเองได้").
//
// The engine turns a fully-assembled per-employee input (rate + timesheet aggregate +
// classified leaves + recurring items + net Service-Charge) into an itemized payslip:
// earnings[] + deductions[] + cached gross/sso/tax/net. Every line carries a label and
// (where relevant) a machine ref so the slip is auditable line-by-line (§A line 79).
//
// Money is always integer satang; every derived amount is Math.round()-ed once at the
// point it becomes a satang figure. All ÷30 uses the company day_divisor (default 30).

// ── §E late-deduction table (per late occurrence, by minutes late) ──────────────
// Calibrated to the client's LIVE payroll sheet ("6. Payment June 2026", 13 late rows):
// 1–30 min → ฿50 · 31–59 → ฿100 · ≥1h → ฿250 per full hour (60–119 → 250, 120 → 500 — both
// observed). The earlier plan text ("free under 15, flat 250 over an hour") does not match the
// sheet, which charges ฿50 from the very first minute (L:1 → 50) and ฿250 at exactly 60.
export const LATE_TIER_15_SATANG = 5000;
export const LATE_TIER_30_SATANG = 10000;
export const LATE_TIER_60_SATANG = 25000;

export function lateDeductionForMinutes(lateMin: number): number {
  if (lateMin <= 0) return 0;
  if (lateMin >= 60) return LATE_TIER_60_SATANG * Math.floor(lateMin / 60);
  if (lateMin > 30) return LATE_TIER_30_SATANG;
  return LATE_TIER_15_SATANG; // charged from the very first minute (sheet: L:1 → ฿50)
}

// ── Thai progressive PND1 annual brackets (baht) ────────────────────────────────
// Standard personal income tax ladder; monthly withholding = annual tax ÷ 12.
const PERSONAL_ALLOWANCE_BAHT = 60_000;
const EXPENSE_RATE = 0.5;
const EXPENSE_CAP_BAHT = 100_000;
const TAX_BRACKETS: { upTo: number; rate: number }[] = [
  { upTo: 150_000, rate: 0 },
  { upTo: 300_000, rate: 0.05 },
  { upTo: 500_000, rate: 0.1 },
  { upTo: 750_000, rate: 0.15 },
  { upTo: 1_000_000, rate: 0.2 },
  { upTo: 2_000_000, rate: 0.25 },
  { upTo: 5_000_000, rate: 0.3 },
  { upTo: Infinity, rate: 0.35 },
];

/**
 * Monthly PND1 withholding (satang) from a monthly labour base (satang), by the standard
 * annualize → deduct expense+personal+SSO+allowances → bracket → ÷12 method. `ssoMonthlySatang`
 * is the employee's own monthly SSO contribution; its ACTUAL annual sum is tax-deductible (the
 * amount is already bounded by the SSO contribution cap — ฿875/mo = ฿10,500/yr at the 2026 ฿17,500
 * wage ceiling; the old ฿9,000/yr limit dated to the ฿750/mo cap and over-taxed high earners,
 * matched to the client's real payroll where a ฿50k salary withholds ฿1,704.17, not ฿1,716.67).
 * `extraAllowancesBaht` is the ANNUAL sum of the employee's ล.ย.01 tax allowances
 * beyond the standard ฿60k personal one (spouse ฿60k, child ฿30k, parent, life/health
 * insurance, provident fund, home-loan interest, donations, …) — 0 when none are on file, so
 * an employee with no ล.ย.01 filed withholds exactly as before.
 */
export function progressiveMonthlyTaxSatang(
  monthlyBaseSatang: number,
  ssoMonthlySatang: number,
  extraAllowancesBaht = 0,
): number {
  const annualBaht = (monthlyBaseSatang / 100) * 12;
  const expense = Math.min(annualBaht * EXPENSE_RATE, EXPENSE_CAP_BAHT);
  const ssoAnnual = (ssoMonthlySatang / 100) * 12; // actual contribution (already capped at ฿875/mo)
  const allowances = Math.max(0, extraAllowancesBaht);
  const taxable = Math.max(0, annualBaht - expense - PERSONAL_ALLOWANCE_BAHT - ssoAnnual - allowances);

  let tax = 0;
  let lower = 0;
  for (const b of TAX_BRACKETS) {
    if (taxable > lower) {
      const slice = Math.min(taxable, b.upTo) - lower;
      tax += slice * b.rate;
      lower = b.upTo;
    } else break;
  }
  // annual tax (baht) → monthly satang
  return Math.round((tax / 12) * 100);
}

// ── Engine I/O types ────────────────────────────────────────────────────────────

export type PayType = 'full_monthly' | 'pt_hourly' | 'pt_daily' | 'pt_monthly';
export type TaxMode = 'progressive' | 'withholding_3pct' | 'none';

export interface PayrollEmployee {
  rate_satang: number;
  pay_type: PayType;
  ot_eligible: boolean;
  ot_hour_divisor: number; // 8 | 9 (per person)
  tax_mode: TaxMode;
  sso_enrolled: boolean;
  /** Annual ล.ย.01 tax allowances beyond the standard ฿60k personal one (spouse/child/
   *  insurance/…), in BAHT. Optional — defaults to 0 (withholds as if none filed). NOTE: the
   *  employee's own PVD contribution is added automatically below and must NOT be double-counted
   *  here. */
  tax_allowances_baht?: number;
  /** Provident-fund enrolment + the employee's own contribution rate (fraction, e.g. 0.03).
   *  Deducted from net and (annualized) added to the tax-allowance base. Full-time only. */
  pvd_enrolled?: boolean;
  pvd_employee_rate?: number;
}

export interface PayrollCompany {
  sso_rate: number; // 0.05
  sso_wage_ceiling_satang: number; // 1_750_000 → cap 87_500 satang
  day_divisor: number; // 30
  ot1_multiplier: number; // 1.5 (standard work-day OT)
}

/** Pre-aggregated timesheet numbers for the pay period (from time-engine sumDays). */
export interface PayrollTimesheet {
  worked_days: number; // days with an in-punch (for pt_daily/pt_monthly base)
  pt_hours: number; // hours worked (for pt_hourly base)
  ot_minutes_eligible: number; // OT minutes, already gated on ot_eligible upstream
  late_minutes_per_occurrence: number[]; // one entry per late day (its late_min)
  unauthorized_absent_days: number; // absent days NOT covered by an approved leave
}

/** One classified approved leave overlapping the period (from classifyLeaveEffect). */
export interface PayrollLeave {
  leave_id: string;
  label: string; // e.g. "ลากิจ" / leave type name
  salary_days: number; // days that dock salary (deductSalary × count)
  travel_days: number; // days that dock the travel allowance
}

export type EarningType =
  | 'salary'
  | 'ot'
  | 'allowance'
  | 'service_charge'
  | 'tip'
  | 'commission'
  | 'eval_bonus'
  | 'claim';
export type DeductionType =
  | 'sso'
  | 'tax'
  | 'late'
  | 'absent'
  | 'leave_unpaid'
  | 'travel_leave'
  | 'student_loan'
  | 'advance'
  | 'guarantee'
  | 'loan'
  | 'provident_fund'
  | 'other';

export interface PayslipLine {
  type: EarningType | DeductionType;
  label: string;
  amount_satang: number;
  ref?: string | null; // machine reference (leave_id / "N days" / warning_id …)
}

/** A recurring monthly allowance (earning). `code='travel'` is prorated on leave days. */
export interface RecurringEarning {
  code: string; // cost_of_living | housing | phone | travel | holiday_comp | other
  label: string;
  amount_satang: number;
}
/** A recurring monthly deduction (fixed). */
export interface RecurringDeduction {
  type: DeductionType;
  label: string;
  amount_satang: number;
}
/** An ad-hoc earning resolved elsewhere (approved claim, commission, eval bonus). */
export interface ExtraEarning {
  type: EarningType;
  label: string;
  amount_satang: number;
  ref?: string | null;
}

export interface PayrollInput {
  employee: PayrollEmployee;
  company: PayrollCompany;
  timesheet: PayrollTimesheet;
  leaves: PayrollLeave[];
  allowances: RecurringEarning[];
  recurringDeductions: RecurringDeduction[];
  extraEarnings: ExtraEarning[];
  scNetSatang: number; // net Service Charge for the period (P4.1); 0 for part-time
  tipNetSatang?: number; // net Tip pool for the period (P4.4, same mechanism as SC); 0/undefined = none
}

export interface Payslip {
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  gross_satang: number;
  sso_satang: number;
  tax_satang: number;
  total_deduction_satang: number;
  net_satang: number;
}

const TRAVEL_CODE = 'travel';

function isPartTime(t: PayType): boolean {
  return t === 'pt_hourly' || t === 'pt_daily' || t === 'pt_monthly';
}

/** Daily rate in satang (rate ÷ day_divisor), unrounded — round only at the final line. */
function dailyRate(rateSatang: number, dayDivisor: number): number {
  return rateSatang / dayDivisor;
}

/** Base labour earning for the period (before allowances/OT), per pay type. */
function computeBaseSalary(emp: PayrollEmployee, ts: PayrollTimesheet, dayDivisor: number): number {
  switch (emp.pay_type) {
    case 'pt_hourly':
      return Math.round(emp.rate_satang * ts.pt_hours);
    case 'pt_daily':
      return Math.round(emp.rate_satang * ts.worked_days);
    case 'pt_monthly':
      return Math.round(dailyRate(emp.rate_satang, dayDivisor) * ts.worked_days);
    case 'full_monthly':
    default:
      // Full base shown in full; absence/leave days are separate deduction lines (§H).
      return emp.rate_satang;
  }
}

/** OT earning (satang) — (rate ÷ divisor_days ÷ ot_hour_divisor) × ot1 × hours. */
function computeOt(emp: PayrollEmployee, company: PayrollCompany, otMinutes: number): number {
  if (!emp.ot_eligible || isPartTime(emp.pay_type) || otMinutes <= 0) return 0;
  const hourlyRate = dailyRate(emp.rate_satang, company.day_divisor) / emp.ot_hour_divisor;
  return Math.round(hourlyRate * company.ot1_multiplier * (otMinutes / 60));
}

/**
 * Compute one employee's payslip for the period. Pure — the caller assembles all inputs
 * (timesheet aggregate, classified leaves, recurring config, net SC). Returns itemized
 * earnings + deductions and the cached gross/sso/tax/net.
 */
export function computePayslip(input: PayrollInput): Payslip {
  const { employee: emp, company, timesheet: ts, leaves } = input;
  const partTime = isPartTime(emp.pay_type);
  const dayDiv = company.day_divisor;

  const earnings: PayslipLine[] = [];
  const deductions: PayslipLine[] = [];

  // ── Earnings ──────────────────────────────────────────────────────────────
  const baseSalary = computeBaseSalary(emp, ts, dayDiv);
  earnings.push({ type: 'salary', label: 'salary', amount_satang: baseSalary });

  const ot = computeOt(emp, company, ts.ot_minutes_eligible);
  if (ot > 0) {
    earnings.push({
      type: 'ot',
      label: 'ot',
      amount_satang: ot,
      ref: `${(ts.ot_minutes_eligible / 60).toFixed(2)}h`,
    });
  }

  // Recurring allowances (full amount; travel is docked per leave day below).
  for (const a of input.allowances) {
    if (a.amount_satang > 0) {
      earnings.push({ type: 'allowance', label: a.label, amount_satang: a.amount_satang, ref: a.code });
    }
  }

  // Service Charge (never for part-time).
  if (!partTime && input.scNetSatang > 0) {
    earnings.push({ type: 'service_charge', label: 'service_charge', amount_satang: input.scNetSatang });
  }

  // Tip pool (same manual pool/allocation mechanism as SC; net for the period). Part-time may
  // share tips, so — unlike SC — it is NOT gated on pay type.
  if ((input.tipNetSatang ?? 0) > 0) {
    earnings.push({ type: 'tip', label: 'tip', amount_satang: input.tipNetSatang as number });
  }

  // Ad-hoc earnings (approved claims, commission, eval bonus).
  for (const e of input.extraEarnings) {
    if (e.amount_satang > 0) {
      earnings.push({ type: e.type, label: e.label, amount_satang: e.amount_satang, ref: e.ref ?? null });
    }
  }

  const gross = earnings.reduce((s, l) => s + l.amount_satang, 0);

  // ── Statutory deductions ─────────────────────────────────────────────────
  // SSO = min(rate × sso_rate, ceiling × sso_rate); only when enrolled and not part-time.
  let sso = 0;
  if (emp.sso_enrolled && !partTime) {
    const raw = Math.round(emp.rate_satang * company.sso_rate);
    const cap = Math.round(company.sso_wage_ceiling_satang * company.sso_rate);
    sso = Math.min(raw, cap);
  }

  // Provident fund (PVD): employee's own monthly contribution = base × rate (full-time enrolled
  // only). It reduces net pay AND is tax-deductible — its annualized amount is added to the
  // ล.ย.01 allowance base before computing withholding.
  let pvd = 0;
  if (emp.pvd_enrolled && !partTime && (emp.pvd_employee_rate ?? 0) > 0) {
    pvd = Math.round(baseSalary * (emp.pvd_employee_rate as number));
  }
  const pvdAnnualBaht = (pvd / 100) * 12;

  // Tax: progressive PND1 | flat 3% withholding (on the labour base) | none.
  let tax = 0;
  if (emp.tax_mode === 'withholding_3pct') {
    tax = Math.round(baseSalary * 0.03);
  } else if (emp.tax_mode === 'progressive') {
    tax = progressiveMonthlyTaxSatang(baseSalary, sso, (emp.tax_allowances_baht ?? 0) + pvdAnnualBaht);
  }

  // ── Variable deductions (salary side only: leave / absent / late) ─────────
  // Leave (approved): salary docked ÷30 × salary_days; travel allowance docked per travel_day.
  const travelAllowance = input.allowances
    .filter((a) => a.code === TRAVEL_CODE)
    .reduce((s, a) => s + a.amount_satang, 0);

  for (const lv of leaves) {
    if (lv.salary_days > 0 && !partTime) {
      const amt = Math.round(dailyRate(emp.rate_satang, dayDiv) * lv.salary_days);
      if (amt > 0) {
        deductions.push({
          type: 'leave_unpaid',
          label: lv.label,
          amount_satang: amt,
          ref: `${lv.leave_id}:${lv.salary_days}d`,
        });
      }
    }
    if (lv.travel_days > 0 && travelAllowance > 0) {
      const amt = Math.round((travelAllowance / dayDiv) * lv.travel_days);
      if (amt > 0) {
        deductions.push({
          type: 'travel_leave',
          label: lv.label,
          amount_satang: amt,
          ref: `${lv.leave_id}:${lv.travel_days}d`,
        });
      }
    }
  }

  // Unauthorized absence (no leave filed): salary docked ÷30/day.
  if (ts.unauthorized_absent_days > 0 && !partTime) {
    const amt = Math.round(dailyRate(emp.rate_satang, dayDiv) * ts.unauthorized_absent_days);
    if (amt > 0) {
      deductions.push({
        type: 'absent',
        label: 'absent',
        amount_satang: amt,
        ref: `${ts.unauthorized_absent_days}d`,
      });
    }
  }

  // Late (§E table), one charge per late day, summed into a single line.
  const lateTotal = ts.late_minutes_per_occurrence.reduce((s, m) => s + lateDeductionForMinutes(m), 0);
  if (lateTotal > 0) {
    const lateCount = ts.late_minutes_per_occurrence.filter((m) => lateDeductionForMinutes(m) > 0).length;
    deductions.push({ type: 'late', label: 'late', amount_satang: lateTotal, ref: `${lateCount}x` });
  }

  // Recurring fixed deductions (student loan / advance / guarantee / loan / other).
  for (const d of input.recurringDeductions) {
    if (d.amount_satang > 0) {
      deductions.push({ type: d.type, label: d.label, amount_satang: d.amount_satang });
    }
  }

  // Provident fund contribution (employee side), before the statutory lines.
  if (pvd > 0) {
    deductions.push({
      type: 'provident_fund',
      label: 'provident_fund',
      amount_satang: pvd,
      ref: `${((emp.pvd_employee_rate as number) * 100).toFixed(2)}%`,
    });
  }

  // Statutory lines go last in the itemized list (they always render as their own rows).
  if (sso > 0) deductions.push({ type: 'sso', label: 'sso', amount_satang: sso });
  if (tax > 0) deductions.push({ type: 'tax', label: 'tax', amount_satang: tax });

  const totalDeduction = deductions.reduce((s, l) => s + l.amount_satang, 0);
  const net = gross - totalDeduction;

  return {
    earnings,
    deductions,
    gross_satang: gross,
    sso_satang: sso,
    tax_satang: tax,
    total_deduction_satang: totalDeduction,
    net_satang: net,
  };
}
