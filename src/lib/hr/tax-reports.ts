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
