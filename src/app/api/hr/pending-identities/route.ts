import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { callerCanViewConfidentialPay } from '@/lib/hr/pay-visibility';

// GET /api/hr/pending-identities?q= — HR-only search over UNCLAIMED imported roster rows
// (hr_pending_identities) by name or bank account, so HR can onboard a person whose payroll
// data was imported but who has no login yet (owner ask 2026-07-08). Unlike the employee-facing
// options route, this returns the payroll seed (rate/bank/SSO/tax) to PREFILL the add-employee
// form.
//
// The seed follows the pay-visibility rule (pay-visibility.ts) since 2026-09-19. A pending
// identity is not an employee yet, so it carries neither pay_confidential nor a payroll group —
// there is nothing to test the caller against, and the imported rows include ทีมบัญชี, whose pay
// a second HR user must not see anywhere (client 2026-09-11/14/16). So the figures are only
// returned to a can_view_confidential_pay holder; everyone else still gets the person (name,
// code, company, venue, position, pay type, start date) and fills the money in later, or hands
// the row to whoever may see it. Bank-account SEARCH is gated the same way, or the box would be
// an oracle for guessing account numbers.
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = (request.nextUrl.searchParams.get('q') ?? '').trim();
  // Strip PostgREST/ilike control characters so the value can't alter the .or() filter grammar.
  const q = raw.replace(/[%_,()*]/g, '').trim();
  if (q.length < 2) return NextResponse.json({ data: [] });

  const service = createServiceClient();
  const canViewPay = await callerCanViewConfidentialPay(service, auth.userId);
  const like = `%${q}%`;
  const searchFilters = [
    `full_name_th.ilike.${like}`,
    `full_name_en.ilike.${like}`,
    `employee_code.ilike.${like}`,
    ...(canViewPay ? [`bank_account_no.ilike.${like}`] : []),
  ];
  const { data, error } = await service
    .from('hr_pending_identities')
    .select(
      'id, full_name_th, full_name_en, employee_code, company_id, store_id, position_text, ' +
        'rate_satang, pay_type, start_date, sso_enrolled, tax_mode, bank_name, bank_account_no, ' +
        'sheet_ref, store:stores(store_name)'
    )
    .eq('status', 'unclaimed')
    .or(searchFilters.join(','))
    .order('full_name_th')
    .limit(12);
  if (error) return NextResponse.json({ error: 'Failed to search roster' }, { status: 500 });

  // The embedded `store:stores(...)` makes the typed-select inference collapse to an error union;
  // cast to the concrete shape we selected.
  type RawRow = {
    id: string;
    full_name_th: string;
    full_name_en: string | null;
    employee_code: string | null;
    company_id: string | null;
    store_id: string | null;
    position_text: string | null;
    rate_satang: number | null;
    pay_type: string | null;
    start_date: string | null;
    sso_enrolled: boolean | null;
    tax_mode: string | null;
    bank_name: string | null;
    bank_account_no: string | null;
    sheet_ref: string | null;
    store: { store_name?: string } | null;
  };
  const rows = ((data ?? []) as unknown as RawRow[]).map((r) => ({
    id: r.id as string,
    full_name_th: r.full_name_th as string,
    full_name_en: (r.full_name_en as string | null) ?? null,
    employee_code: (r.employee_code as string | null) ?? null,
    company_id: (r.company_id as string | null) ?? null,
    store_id: (r.store_id as string | null) ?? null,
    store_name: ((r.store as { store_name?: string } | null)?.store_name as string) ?? null,
    position_text: (r.position_text as string | null) ?? null,
    pay_type: (r.pay_type as string | null) ?? null,
    start_date: (r.start_date as string | null) ?? null,
    sso_enrolled: (r.sso_enrolled as boolean | null) ?? null,
    sheet_ref: (r.sheet_ref as string | null) ?? null,
    // The money — same columns EMPLOYEE_PAY_COLUMNS names on hr_employees, where the row will
    // eventually land. `pay_hidden` tells the form why its prefill came back blank.
    rate_satang: canViewPay ? ((r.rate_satang as number | null) ?? null) : null,
    tax_mode: canViewPay ? ((r.tax_mode as string | null) ?? null) : null,
    bank_name: canViewPay ? ((r.bank_name as string | null) ?? null) : null,
    bank_account_no: canViewPay ? ((r.bank_account_no as string | null) ?? null) : null,
    pay_hidden: !canViewPay,
  }));
  return NextResponse.json({ data: rows });
}
