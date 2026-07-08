import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';

// GET /api/hr/pending-identities?q= — HR-only search over UNCLAIMED imported roster rows
// (hr_pending_identities) by name or bank account, so HR can onboard a person whose payroll
// data was imported but who has no login yet (owner ask 2026-07-08). Unlike the employee-facing
// options route, this returns the full payroll seed (rate/bank/SSO/tax) to PREFILL the add-employee
// form — appropriate because the caller is a verified HR manager.
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = (request.nextUrl.searchParams.get('q') ?? '').trim();
  // Strip PostgREST/ilike control characters so the value can't alter the .or() filter grammar.
  const q = raw.replace(/[%_,()*]/g, '').trim();
  if (q.length < 2) return NextResponse.json({ data: [] });

  const service = createServiceClient();
  const like = `%${q}%`;
  const { data, error } = await service
    .from('hr_pending_identities')
    .select(
      'id, full_name_th, full_name_en, employee_code, company_id, store_id, position_text, ' +
        'rate_satang, pay_type, start_date, sso_enrolled, tax_mode, bank_name, bank_account_no, ' +
        'sheet_ref, store:stores(store_name)'
    )
    .eq('status', 'unclaimed')
    .or(
      `full_name_th.ilike.${like},full_name_en.ilike.${like},bank_account_no.ilike.${like},employee_code.ilike.${like}`
    )
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
    rate_satang: (r.rate_satang as number | null) ?? null,
    pay_type: (r.pay_type as string | null) ?? null,
    start_date: (r.start_date as string | null) ?? null,
    sso_enrolled: (r.sso_enrolled as boolean | null) ?? null,
    tax_mode: (r.tax_mode as string | null) ?? null,
    bank_name: (r.bank_name as string | null) ?? null,
    bank_account_no: (r.bank_account_no as string | null) ?? null,
    sheet_ref: (r.sheet_ref as string | null) ?? null,
  }));
  return NextResponse.json({ data: rows });
}
