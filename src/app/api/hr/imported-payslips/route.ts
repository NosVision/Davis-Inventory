import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';

// GET /api/hr/imported-payslips — HR-only read of the legacy payslip archive
// (hr_imported_payslips). Three modes:
//   ?facets=1                         → companies + available months that have data
//   ?company_id=&year=&month=         → all rows for one branch/month (browse)
//   ?employee_id=                     → one employee's full history, newest first
const COLS =
  'id, company_id, employee_id, pending_identity_id, period_year, period_month, sheet_ref,' +
  ' name_th, name_en, nickname, position_text, rate_satang, worked_days, off_days, period_days,' +
  ' ot_hours, ot_pay_satang, holiday_pay_satang, transportation_satang, pay_transportation_satang,' +
  ' service_satang, leaves, deduction_satang, deduction_breakdown, gross_satang, sso5_satang,' +
  ' sso3_satang, tax_satang, net_satang';

export async function GET(req: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const sp = req.nextUrl.searchParams;

  if (sp.get('facets')) {
    const [{ data: rows }, { data: companies }] = await Promise.all([
      service.from('hr_imported_payslips').select('company_id, period_year, period_month'),
      service.from('hr_companies').select('id, name'),
    ]);
    const nameById = new Map((companies ?? []).map((c) => [c.id as string, c.name as string]));
    const compCount = new Map<string, number>();
    const monthSet = new Set<string>();
    for (const r of rows ?? []) {
      compCount.set(r.company_id as string, (compCount.get(r.company_id as string) ?? 0) + 1);
      monthSet.add(`${r.period_year}-${String(r.period_month).padStart(2, '0')}`);
    }
    const facetCompanies = [...compCount.entries()]
      .map(([id, n]) => ({ id, name: nameById.get(id) ?? id, n }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const months = [...monthSet].sort().reverse();
    return NextResponse.json({ companies: facetCompanies, months });
  }

  const employeeId = sp.get('employee_id');
  if (employeeId) {
    const { data, error } = await service
      .from('hr_imported_payslips')
      .select(COLS)
      .eq('employee_id', employeeId)
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false });
    if (error) return NextResponse.json({ error: 'Failed to load history' }, { status: 500 });
    return NextResponse.json({ data: data ?? [] });
  }

  const companyId = sp.get('company_id');
  const year = Number(sp.get('year'));
  const month = Number(sp.get('month'));
  if (!companyId || !year || !month) {
    return NextResponse.json({ error: 'company_id, year and month are required' }, { status: 400 });
  }
  const { data, error } = await service
    .from('hr_imported_payslips')
    .select(COLS)
    .eq('company_id', companyId)
    .eq('period_year', year)
    .eq('period_month', month)
    .order('net_satang', { ascending: false, nullsFirst: false });
  if (error) return NextResponse.json({ error: 'Failed to load payslips' }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
