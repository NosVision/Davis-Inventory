// HR statutory report compute cores (P5.2, §J9) — PURE aggregation, no I/O.
//
// The government filings are aggregations over finalized payslips for a period. This module
// owns the exact math (which must reconcile to the baht); PDF/e-filing layout is route/UI work
// built on top. Money is integer satang throughout; the ÷100 to baht happens only at display.
//
//   - ภ.ง.ด.1  (PND1)  : monthly withholding-tax filing — one detail line per employee with
//                        income + tax withheld, plus a summary total.
//   - สปส.1-10 (SSO)   : monthly Social Security filing — per employee the wage base and the
//                        5% employee contribution (cap ฿750/mo on the ฿15,000 wage ceiling
//                        → ตาม HR-PLAN เพดานหัก 875 บนเพดานค่าจ้าง 17,500), plus the matching
//                        employer contribution and the grand total remitted.
//   - 50 ทวิ  (annual) : per-employee annual certificate — total income + total tax withheld
//                        across the year's payslips.

/** One employee's line as it appears on a finalized payslip, for report aggregation. */
export interface PayslipLineInput {
  employee_id: string;
  employee_name: string;
  tax_id: string | null; // 13-digit; shown on the filings
  sso_no: string | null;
  gross_satang: number; // total earnings (income) on the slip
  tax_satang: number; // withholding tax deducted
  sso_satang: number; // employee SSO contribution deducted
  sso_wage_base_satang: number; // the wage the SSO was computed on (min(rate, ceiling))
}

// ── ภ.ง.ด.1 (monthly withholding tax) ─────────────────────────────────────────
export interface Pnd1Line {
  employee_id: string;
  employee_name: string;
  tax_id: string | null;
  income_satang: number;
  tax_satang: number;
}
export interface Pnd1Report {
  lines: Pnd1Line[]; // only employees who actually had tax withheld
  employee_count: number;
  total_income_satang: number;
  total_tax_satang: number;
}

/**
 * Build the ภ.ง.ด.1 detail + totals for a period. Only slips with tax_satang > 0 appear on the
 * filing (an employee with no withholding is not reported on PND1). Totals sum the detail lines
 * so the filing reconciles exactly.
 */
export function buildPnd1(slips: PayslipLineInput[]): Pnd1Report {
  const lines: Pnd1Line[] = [];
  for (const s of slips) {
    if (s.tax_satang > 0) {
      lines.push({
        employee_id: s.employee_id,
        employee_name: s.employee_name,
        tax_id: s.tax_id,
        income_satang: s.gross_satang,
        tax_satang: s.tax_satang,
      });
    }
  }
  return {
    lines,
    employee_count: lines.length,
    total_income_satang: lines.reduce((sum, l) => sum + l.income_satang, 0),
    total_tax_satang: lines.reduce((sum, l) => sum + l.tax_satang, 0),
  };
}

// ── สปส.1-10 (monthly Social Security) ────────────────────────────────────────
export interface SsoLine {
  employee_id: string;
  employee_name: string;
  sso_no: string | null;
  wage_base_satang: number;
  employee_satang: number; // 5% employee side (already computed on the slip, capped)
  employer_satang: number; // matching employer side (same amount, §J9)
}
export interface SsoReport {
  lines: SsoLine[]; // only enrolled employees (sso_satang > 0)
  employee_count: number;
  total_wage_base_satang: number;
  total_employee_satang: number;
  total_employer_satang: number;
  total_remit_satang: number; // employee + employer
}

/**
 * Build the สปส.1-10 detail + totals. Employer contribution matches the employee's (Thai SSO is
 * symmetric 5%/5% with the same ฿ cap), so employer_satang = employee_satang per line. Only
 * enrolled employees (sso_satang > 0) are filed. Grand total remitted = Σ(employee+employer).
 */
export function buildSso(slips: PayslipLineInput[]): SsoReport {
  const lines: SsoLine[] = [];
  for (const s of slips) {
    if (s.sso_satang > 0) {
      lines.push({
        employee_id: s.employee_id,
        employee_name: s.employee_name,
        sso_no: s.sso_no,
        wage_base_satang: s.sso_wage_base_satang,
        employee_satang: s.sso_satang,
        employer_satang: s.sso_satang,
      });
    }
  }
  const totalEmp = lines.reduce((sum, l) => sum + l.employee_satang, 0);
  const totalEr = lines.reduce((sum, l) => sum + l.employer_satang, 0);
  return {
    lines,
    employee_count: lines.length,
    total_wage_base_satang: lines.reduce((sum, l) => sum + l.wage_base_satang, 0),
    total_employee_satang: totalEmp,
    total_employer_satang: totalEr,
    total_remit_satang: totalEmp + totalEr,
  };
}

// ── 50 ทวิ (annual withholding certificate, per employee) ─────────────────────
export interface Cert50TwiInput {
  employee_id: string;
  gross_satang: number;
  tax_satang: number;
  sso_satang: number;
}
export interface Cert50Twi {
  employee_id: string;
  months_count: number; // payslips contributing (for reference)
  total_income_satang: number;
  total_tax_satang: number;
  total_sso_satang: number; // employee's own SSO (a §40(1) deduction on the cert)
}

/**
 * Aggregate a single employee's payslips across the year into their 50 ทวิ figures. Caller
 * groups by employee first, then hands one employee's slips here. Empty → all zeros.
 */
export function buildCert50Twi(employeeId: string, slips: Cert50TwiInput[]): Cert50Twi {
  return {
    employee_id: employeeId,
    months_count: slips.length,
    total_income_satang: slips.reduce((sum, s) => sum + s.gross_satang, 0),
    total_tax_satang: slips.reduce((sum, s) => sum + s.tax_satang, 0),
    total_sso_satang: slips.reduce((sum, s) => sum + s.sso_satang, 0),
  };
}

// ── ทะเบียนเงินเดือน / ต้นทุนแรงงาน (payroll register + labor cost, P5/P5.4) ──────
export interface RegisterLineInput {
  employee_id: string;
  employee_name: string;
  gross_satang: number; // total earnings (company labor cost, employee side)
  sso_satang: number; // employee SSO withheld
  tax_satang: number; // tax withheld
  total_deduction_satang: number; // all deductions on the slip
  net_satang: number; // take-home
}
export interface PayrollRegister {
  lines: RegisterLineInput[];
  employee_count: number;
  total_gross_satang: number;
  total_sso_satang: number; // employee side
  total_tax_satang: number;
  total_deduction_satang: number;
  total_net_satang: number;
  /** Employer's total labor cost = gross + employer SSO match (Thai SSO symmetric). */
  employer_sso_satang: number;
  total_labor_cost_satang: number;
}

/**
 * Payroll register for a payrun: per-employee gross/sso/tax/net + column totals, plus the true
 * employer labor cost (gross + the matching employer SSO). The register's totals must tie out to
 * the sum of the individual payslips (audit/accounting reconciliation).
 */
export function buildPayrollRegister(slips: RegisterLineInput[]): PayrollRegister {
  const totalSso = slips.reduce((s, l) => s + l.sso_satang, 0);
  const totalGross = slips.reduce((s, l) => s + l.gross_satang, 0);
  return {
    lines: slips,
    employee_count: slips.length,
    total_gross_satang: totalGross,
    total_sso_satang: totalSso,
    total_tax_satang: slips.reduce((s, l) => s + l.tax_satang, 0),
    total_deduction_satang: slips.reduce((s, l) => s + l.total_deduction_satang, 0),
    total_net_satang: slips.reduce((s, l) => s + l.net_satang, 0),
    employer_sso_satang: totalSso, // employer matches the employee SSO
    total_labor_cost_satang: totalGross + totalSso,
  };
}

/**
 * Labor-cost-to-sales ratio (§P5.4) — a REPORT metric, not a homepage KPI. Returns null when
 * sales is 0/negative (undefined ratio, not 0%). Percentage 0..∞ (a store can exceed 100%).
 */
export function laborCostPct(totalLaborCostSatang: number, salesSatang: number): number | null {
  if (salesSatang <= 0) return null;
  return (totalLaborCostSatang / salesSatang) * 100;
}

// ── ภ.ง.ด.1ก (annual withholding summary, §J9) ────────────────────────────────
// The year-end aggregate: per employee, sum ALL of the year's monthly slips into one line
// (total income + total tax withheld); the summary totals feed the annual RD filing.
export interface Pnd1kInput {
  employee_id: string;
  employee_name: string;
  tax_id: string | null;
  gross_satang: number;
  tax_satang: number;
}
export interface Pnd1kLine {
  employee_id: string;
  employee_name: string;
  tax_id: string | null;
  months_count: number;
  income_satang: number;
  tax_satang: number;
}
export interface Pnd1kReport {
  lines: Pnd1kLine[];
  employee_count: number;
  total_income_satang: number;
  total_tax_satang: number;
}

/**
 * Build ภ.ง.ด.1ก from a whole year's monthly slip rows (any month, any employee). Groups by
 * employee, sums income + tax, and includes EVERY employee who had income during the year (even
 * if their tax withheld was 0 — 1ก reports all employees, unlike the monthly 1 which lists only
 * those with withholding). Lines sorted by name for a stable filing.
 */
export function buildPnd1k(rows: Pnd1kInput[]): Pnd1kReport {
  const byEmployee = new Map<string, Pnd1kLine>();
  for (const r of rows) {
    const line = byEmployee.get(r.employee_id) ?? {
      employee_id: r.employee_id, employee_name: r.employee_name, tax_id: r.tax_id,
      months_count: 0, income_satang: 0, tax_satang: 0,
    };
    line.months_count += 1;
    line.income_satang += r.gross_satang;
    line.tax_satang += r.tax_satang;
    byEmployee.set(r.employee_id, line);
  }
  const lines = [...byEmployee.values()].sort((a, b) => a.employee_name.localeCompare(b.employee_name));
  return {
    lines,
    employee_count: lines.length,
    total_income_satang: lines.reduce((s, l) => s + l.income_satang, 0),
    total_tax_satang: lines.reduce((s, l) => s + l.tax_satang, 0),
  };
}

// ── e-filing export (RD online upload) ────────────────────────────────────────
// The Revenue Department's bulk-upload text is a delimited file: one line per employee with the
// 13-digit tax id, name, income and tax in BAHT with 2 decimals (a dot, no thousands sep). The
// exact column set differs by RD form/version, so this is a pragmatic CSV an accountant maps to
// the RD template — the amount/id encoding (the error-prone part) is what's pinned here.

/** satang integer → "N.NN" baht (final display string; no re-rounding). */
function satangToBahtField(satang: number): string {
  const sign = satang < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(satang));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const PND1_EFILING_HEADER = ['tax_id', 'employee_name', 'income_baht', 'tax_baht'] as const;

/** Build the ภ.ง.ด.1 / 1ก e-filing CSV from PND1-style lines (income+tax already in satang). */
export function buildPnd1EfilingCsv(
  lines: { tax_id: string | null; employee_name: string; income_satang: number; tax_satang: number }[],
): string {
  const out = [PND1_EFILING_HEADER.join(',')];
  for (const l of lines) {
    out.push(
      [
        (l.tax_id ?? '').replace(/\D/g, ''), // digits only
        l.employee_name ?? '',
        satangToBahtField(l.income_satang),
        satangToBahtField(l.tax_satang),
      ]
        .map((c) => csvCell(String(c)))
        .join(','),
    );
  }
  return out.join('\r\n') + '\r\n';
}
