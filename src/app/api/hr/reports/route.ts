import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import {
  buildPnd1,
  buildSso,
  buildCert50Twi,
  buildPnd1k,
  buildPayrollRegister,
  buildPnd1EfilingCsv,
  type PayslipLineInput,
} from '@/lib/hr/tax-reports';

// The tax-report input plus the two register-only figures (net + total deduction), so a single
// assembly pass feeds every report. The extra fields are ignored by buildPnd1/buildSso/buildCert50Twi.
interface EnrichedSlip extends PayslipLineInput {
  total_deduction_satang: number;
  net_satang: number;
}

// Statutory report routes (P5.2, §J9). HR only. Aggregate FINALIZED payslips for a company over a
// period into the government filings (ภ.ง.ด.1 / 1ก, สปส.1-10, 50ทวิ, payroll register) using the
// PURE compute cores in lib/hr/tax-reports.ts — this route only assembles the inputs and dispatches.
// Only finalized payruns are reportable (a draft is still changing; you file after finalizing).

const MONTHLY_TYPES = new Set(['pnd1', 'sso', 'register']);
const ANNUAL_TYPES = new Set(['cert50twi', 'pnd1k']);

interface EmpMeta {
  tax_id: string | null;
  sso_no: string | null;
  rate_satang: number;
}
interface SlipRow {
  employee_id: string | null;
  user_id: string;
  gross_satang: number;
  tax_satang: number;
  sso_satang: number;
  total_deduction_satang: number;
  net_satang: number;
}

// GET /api/hr/reports?type=&company_id=&year=&month=&employee_id=&format=
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = request.nextUrl.searchParams;
  const type = sp.get('type') ?? '';
  const companyId = sp.get('company_id') ?? '';
  const year = Number(sp.get('year'));
  const monthRaw = sp.get('month');
  const employeeFilter = sp.get('employee_id');
  const asCsv = sp.get('format') === 'csv';

  if (!MONTHLY_TYPES.has(type) && !ANNUAL_TYPES.has(type)) {
    return NextResponse.json({ error: 'type must be one of pnd1, sso, register, cert50twi, pnd1k' }, { status: 400 });
  }
  if (!companyId) return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'a valid year is required' }, { status: 400 });
  }
  const month = Number(monthRaw);
  if (MONTHLY_TYPES.has(type) && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return NextResponse.json({ error: 'a valid month (1-12) is required for this report' }, { status: 400 });
  }

  const service = createServiceClient();

  // Company config (SSO wage ceiling → wage base = min(rate, ceiling)).
  const { data: company, error: coErr } = await service
    .from('hr_companies')
    .select('id, name, sso_wage_ceiling_satang')
    .eq('id', companyId)
    .maybeSingle();
  if (coErr) return NextResponse.json({ error: 'Failed to load company' }, { status: 500 });
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  const ceiling = Number(company.sso_wage_ceiling_satang) || 1_750_000;

  // Finalized payruns for the period (monthly → that month; annual → the whole year).
  let runQuery = service
    .from('hr_payruns')
    .select('id')
    .eq('company_id', companyId)
    .eq('period_year', year)
    .eq('status', 'finalized');
  if (MONTHLY_TYPES.has(type)) runQuery = runQuery.eq('period_month', month);
  const { data: runs, error: runErr } = await runQuery;
  if (runErr) return NextResponse.json({ error: 'Failed to load payruns' }, { status: 500 });
  const runIds = (runs ?? []).map((r) => r.id as string);

  // Assemble the enriched payslip lines for those payruns.
  const lines = await assembleLines(service, runIds, ceiling);

  switch (type) {
    case 'pnd1': {
      const report = buildPnd1(lines);
      if (asCsv) {
        return csvResponse(buildPnd1EfilingCsv(report.lines), `pnd1_${year}${pad(month)}.csv`);
      }
      return NextResponse.json({ data: { company: company.name, year, month, report } });
    }
    case 'sso': {
      return NextResponse.json({ data: { company: company.name, year, month, report: buildSso(lines) } });
    }
    case 'register': {
      return NextResponse.json({
        data: { company: company.name, year, month, report: buildPayrollRegister(lines.map(registerLine)) },
      });
    }
    case 'pnd1k': {
      const report = buildPnd1k(lines);
      if (asCsv) return csvResponse(buildPnd1EfilingCsv(report.lines), `pnd1k_${year}.csv`);
      return NextResponse.json({ data: { company: company.name, year, report } });
    }
    case 'cert50twi': {
      // One certificate per employee (or a single employee when employee_id is given).
      const byEmp = new Map<string, PayslipLineInput[]>();
      for (const l of lines) {
        if (employeeFilter && l.employee_id !== employeeFilter) continue;
        const list = byEmp.get(l.employee_id) ?? [];
        list.push(l);
        byEmp.set(l.employee_id, list);
      }
      const certs = [...byEmp.entries()].map(([empId, slips]) => ({
        ...buildCert50Twi(empId, slips),
        employee_name: slips[0]?.employee_name ?? '',
        tax_id: slips[0]?.tax_id ?? null,
      }));
      return NextResponse.json({ data: { company: company.name, year, certificates: certs } });
    }
    default:
      return NextResponse.json({ error: 'unsupported type' }, { status: 400 });
  }
}

// Load payslips for the given payruns and enrich each with employee tax/sso identifiers, the
// profile display name, and the SSO wage base. Returns PayslipLineInput (+ employee_name is on it).
async function assembleLines(
  service: ReturnType<typeof createServiceClient>,
  runIds: string[],
  ceiling: number,
): Promise<EnrichedSlip[]> {
  if (runIds.length === 0) return [];

  const { data: slips } = await service
    .from('hr_payslips')
    .select('employee_id, user_id, gross_satang, tax_satang, sso_satang, total_deduction_satang, net_satang')
    .in('payrun_id', runIds);
  const slipRows = (slips ?? []) as SlipRow[];
  if (slipRows.length === 0) return [];

  const empIds = [...new Set(slipRows.map((s) => s.employee_id).filter(Boolean))] as string[];
  const userIds = [...new Set(slipRows.map((s) => s.user_id))];

  const empById = new Map<string, EmpMeta>();
  if (empIds.length) {
    const { data: emps } = await service
      .from('hr_employees')
      .select('id, tax_id, sso_no, rate_satang')
      .in('id', empIds);
    for (const e of (emps ?? []) as (EmpMeta & { id: string })[]) {
      empById.set(e.id, { tax_id: e.tax_id, sso_no: e.sso_no, rate_satang: Number(e.rate_satang) || 0 });
    }
  }
  const nameByUser = new Map<string, string>();
  const { data: profs } = await service.from('profiles').select('id, username, display_name').in('id', userIds);
  for (const p of (profs ?? []) as { id: string; username: string | null; display_name: string | null }[]) {
    nameByUser.set(p.id, p.display_name || p.username || '—');
  }

  return slipRows.map((s) => {
    const emp = s.employee_id ? empById.get(s.employee_id) : undefined;
    // Wage base the SSO was computed on: min(monthly rate, ceiling) for enrolled (sso>0) employees.
    const wageBase = s.sso_satang > 0 ? Math.min(emp?.rate_satang ?? 0, ceiling) : 0;
    return {
      employee_id: (s.employee_id ?? s.user_id) as string,
      employee_name: nameByUser.get(s.user_id) ?? '—',
      tax_id: emp?.tax_id ?? null,
      sso_no: emp?.sso_no ?? null,
      gross_satang: s.gross_satang,
      tax_satang: s.tax_satang,
      sso_satang: s.sso_satang,
      sso_wage_base_satang: wageBase,
      total_deduction_satang: s.total_deduction_satang,
      net_satang: s.net_satang,
    };
  });
}

function registerLine(l: EnrichedSlip) {
  return {
    employee_id: l.employee_id,
    employee_name: l.employee_name,
    gross_satang: l.gross_satang,
    sso_satang: l.sso_satang,
    tax_satang: l.tax_satang,
    total_deduction_satang: l.total_deduction_satang,
    net_satang: l.net_satang,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
