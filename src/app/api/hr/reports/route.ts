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
import { buildEmployeeNameMap } from '@/lib/hr/employee-name-map';
import { refuseIfConfidentialInScope } from '@/lib/hr/pay-visibility';
import { logHrAudit } from '@/lib/hr/audit';

// The tax-report input plus the two register-only figures (net + total deduction), so a single
// assembly pass feeds every report. The extra fields are ignored by buildPnd1/buildSso/buildCert50Twi.
interface EnrichedSlip extends PayslipLineInput {
  total_deduction_satang: number;
  net_satang: number;
  /** employer PVD match for this slip (register/labor-cost reporting) */
  pvd_employer_satang: number;
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
  pvd_enrolled: boolean;
  pvd_employer_rate: number;
  pay_type: string | null;
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

/**
 * Issuance log for the statutory filings.
 *
 * Nothing recorded who produced ภ.ง.ด.1 for which month, so "has August been filed, and by whom?"
 * had no answer anywhere in the system — the reports are rebuilt from the payruns on every view
 * and never stored. Restricting WHO may issue them (§00195) without recording THAT they were
 * issued would have been half a control.
 *
 * Only a real export is logged — the CSV e-filing and the 50 ทวิ PDF. Opening the on-screen table
 * is browsing, and logging every type/period change would bury the real events.
 *
 * `hr_tax_documents` is a label, not a table: the filings have no rows of their own. record_id is
 * the company, which is the only real id involved, and the period/type live in `after`.
 */
const ISSUANCE_TABLE = 'hr_tax_documents';

const TYPE_LABEL: Record<string, string> = {
  pnd1: 'ภ.ง.ด.1',
  sso: 'สปส.1-10',
  register: 'ทะเบียนค่าจ้าง',
  pnd1k: 'ภ.ง.ด.1ก',
  cert50twi: 'ใบ 50 ทวิ',
};

interface IssuanceKey {
  companyId: string;
  type: string;
  year: number;
  /** null for the annual filings, which have no month. */
  month: number | null;
}

function periodLabel(key: IssuanceKey): string {
  const be = key.year + 543;
  return key.month ? `${String(key.month).padStart(2, '0')}/${be}` : `ปี ${be}`;
}

/** The previous issuance of this exact filing, so the screen can say whether it has been done. */
async function readLastIssuance(
  service: ReturnType<typeof createServiceClient>,
  key: IssuanceKey
): Promise<{ at: string; by: string | null; format: string | null } | null> {
  const { data } = await service
    .from('hr_audit_log')
    .select('created_at, actor_id, after, actor:profiles!hr_audit_log_actor_id_fkey(display_name, username)')
    .eq('table_name', ISSUANCE_TABLE)
    .eq('record_id', key.companyId)
    .order('created_at', { ascending: false })
    .limit(50);

  // PostgREST types a to-one embed as an array; at runtime it is the object. Accept both.
  type ActorRef = { display_name: string | null; username: string | null };
  for (const row of (data ?? []) as unknown as {
    created_at: string;
    after: { type?: string; year?: number; month?: number | null; format?: string } | null;
    actor: ActorRef | ActorRef[] | null;
  }[]) {
    const a = row.after;
    if (!a || a.type !== key.type || a.year !== key.year) continue;
    if ((a.month ?? null) !== key.month) continue;
    const actor = Array.isArray(row.actor) ? row.actor[0] : row.actor;
    return {
      at: row.created_at,
      by: actor?.display_name ?? actor?.username ?? null,
      format: a.format ?? null,
    };
  }
  return null;
}

/** Record that this filing was actually exported. Fire-and-forget, like every other audit write. */
async function recordIssuance(
  service: ReturnType<typeof createServiceClient>,
  actorId: string,
  key: IssuanceKey,
  format: 'csv' | 'pdf',
  companyName: string,
  lineCount: number
): Promise<void> {
  await logHrAudit(service, {
    actorId,
    action: 'create',
    table: ISSUANCE_TABLE,
    recordId: key.companyId,
    before: null,
    after: { type: key.type, year: key.year, month: key.month, format, lines: lineCount },
    reason: `ออก${TYPE_LABEL[key.type] ?? key.type} งวด ${periodLabel(key)} — ${companyName} (${format.toUpperCase()})`,
  });
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
  const lines = await assembleLines(service, runIds, ceiling, auth.userId);

  // Read the PREVIOUS issuance before writing this one, so the screen shows "last filed on …"
  // rather than the export the viewer is making right now.
  const issuanceKey: IssuanceKey = {
    companyId,
    type,
    year,
    month: MONTHLY_TYPES.has(type) ? month : null,
  };
  const lastIssued = await readLastIssuance(service, issuanceKey);

  switch (type) {
    case 'pnd1': {
      const report = buildPnd1(lines);
      if (asCsv) {
        await recordIssuance(service, auth.userId, issuanceKey, 'csv', company.name, report.lines.length);
        return csvResponse(buildPnd1EfilingCsv(report.lines), `pnd1_${year}${pad(month)}.csv`);
      }
      return NextResponse.json({ data: { company: company.name, year, month, report, last_issued: lastIssued } });
    }
    case 'sso': {
      return NextResponse.json({
        data: { company: company.name, year, month, report: buildSso(lines), last_issued: lastIssued },
      });
    }
    case 'register': {
      return NextResponse.json({
        data: {
          company: company.name,
          year,
          month,
          report: buildPayrollRegister(lines.map(registerLine)),
          last_issued: lastIssued,
        },
      });
    }
    case 'pnd1k': {
      const report = buildPnd1k(lines);
      if (asCsv) {
        await recordIssuance(service, auth.userId, issuanceKey, 'csv', company.name, report.lines.length);
        return csvResponse(buildPnd1EfilingCsv(report.lines), `pnd1k_${year}.csv`);
      }
      return NextResponse.json({ data: { company: company.name, year, report, last_issued: lastIssued } });
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
      return NextResponse.json({
        data: { company: company.name, year, certificates: certs, last_issued: lastIssued },
      });
    }
    default:
      return NextResponse.json({ error: 'unsupported type' }, { status: 400 });
  }
}

/**
 * POST /api/hr/reports { type, company_id, year, month?, lines? } — record that a filing was
 * exported as a PDF.
 *
 * The 50 ทวิ PDF is rendered in the browser from the JSON this route already returned, so unlike
 * the CSV it never passes back through the server. Without this the one filing that leaves the
 * building as a finished document would be the only one missing from the issuance log.
 */
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const type = typeof body.type === 'string' ? body.type : '';
  const companyId = typeof body.company_id === 'string' ? body.company_id : '';
  const year = Number(body.year);
  const monthRaw = Number(body.month);
  const month = MONTHLY_TYPES.has(type) && Number.isInteger(monthRaw) ? monthRaw : null;
  const lineCount = Number.isInteger(Number(body.lines)) ? Number(body.lines) : 0;

  if (!MONTHLY_TYPES.has(type) && !ANNUAL_TYPES.has(type)) {
    return NextResponse.json({ error: 'unsupported type' }, { status: 400 });
  }
  if (!companyId || !Number.isInteger(year)) {
    return NextResponse.json({ error: 'company_id and year are required' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: company } = await service
    .from('hr_companies')
    .select('id, name')
    .eq('id', companyId)
    .maybeSingle();
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  // Same gate as producing the filing: a document covering everyone may only be issued by someone
  // who may see everyone. Without this, the log could be written by someone who could not export.
  const { data: slips } = await service
    .from('hr_payruns')
    .select('id')
    .eq('company_id', companyId)
    .eq('period_year', year)
    .eq('status', 'finalized');
  const runIds = (slips ?? []).map((r) => r.id as string);
  if (runIds.length > 0) {
    const { data: slipUsers } = await service
      .from('hr_payslips')
      .select('user_id')
      .in('payrun_id', runIds);
    const refusal = await refuseIfConfidentialInScope(
      service,
      auth.userId,
      [...new Set(((slipUsers ?? []) as { user_id: string }[]).map((u) => u.user_id))]
    );
    if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
  }

  await recordIssuance(
    service,
    auth.userId,
    { companyId, type, year, month },
    'pdf',
    company.name as string,
    lineCount
  );
  return NextResponse.json({ success: true });
}

// Load payslips for the given payruns and enrich each with employee tax/sso identifiers, the
// profile display name, and the SSO wage base. Returns PayslipLineInput (+ employee_name is on it).
async function assembleLines(
  service: ReturnType<typeof createServiceClient>,
  runIds: string[],
  ceiling: number,
  callerId: string,
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
      .select('id, tax_id, sso_no, rate_satang, pvd_enrolled, pvd_employer_rate, pay_type')
      .in('id', empIds);
    for (const e of (emps ?? []) as (EmpMeta & { id: string })[]) {
      empById.set(e.id, {
        tax_id: e.tax_id,
        sso_no: e.sso_no,
        rate_satang: Number(e.rate_satang) || 0,
        pvd_enrolled: Boolean(e.pvd_enrolled),
        pvd_employer_rate: Number(e.pvd_employer_rate) || 0,
        pay_type: e.pay_type ?? null,
      });
    }
  }
  // ภ.ง.ด.1 / สปส. / ใบ 50 ทวิ / ทะเบียนค่าจ้าง are filed with the revenue department, so they carry
  // the legal ชื่อจริง and nothing else — these rows used to go out under profiles.display_name,
  // i.e. the person's ชื่อเล่น. Deliberately NOT the "ชื่อจริง (ชื่อเล่น)" form used on screen.
  // These are statutory filings — they must list EVERY employee, so there is no partial version
  // to hand someone who may not see part of the payroll. Refuse rather than emit a short filing.
  const refusal = await refuseIfConfidentialInScope(service, callerId, userIds);
  if (refusal) throw new Error(refusal);

  const nameEntries = await buildEmployeeNameMap(service, userIds);
  const nameByUser = new Map<string, string>([...nameEntries].map(([id, n]) => [id, n.name]));

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
      // Employer PVD match (full-time enrolled only): rate_satang × employer rate at today's
      // config (rates rarely change; slips don't snapshot the employer side).
      pvd_employer_satang:
        emp && emp.pvd_enrolled && emp.pay_type === 'full_monthly' && emp.pvd_employer_rate > 0
          ? Math.round(emp.rate_satang * emp.pvd_employer_rate)
          : 0,
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
    pvd_employer_satang: l.pvd_employer_satang,
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
