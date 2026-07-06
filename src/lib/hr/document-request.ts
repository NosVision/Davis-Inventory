import type { SupabaseClient } from '@supabase/supabase-js';
import { buildCert50Twi } from '@/lib/hr/tax-reports';

// ⑥ System-generated figures for personal documents. The accountant-file path stores nothing
// here; these builders are for the docs we can derive from finalized payslips.

export interface GeneratedDoc {
  kind: 'cert_50twi' | 'salary_cert';
  [k: string]: unknown;
}

/** 50 ทวิ — aggregate the employee's FINALIZED payslips for a calendar year. */
export async function generate50Twi(
  service: SupabaseClient,
  profileId: string,
  year: number
): Promise<GeneratedDoc | { error: string }> {
  // finalized payruns of the year → this person's slips
  const { data: runs, error: runErr } = await service
    .from('hr_payruns')
    .select('id, period_year, company:hr_companies(name, address, tax_id)')
    .eq('period_year', year)
    .eq('status', 'finalized');
  if (runErr) return { error: 'Failed to load payruns' };
  const runIds = (runs ?? []).map((r) => r.id as string);
  if (runIds.length === 0) {
    return { kind: 'cert_50twi', year, months_count: 0, total_income_satang: 0, total_tax_satang: 0, total_sso_satang: 0, company: null };
  }

  const { data: slips, error: slipErr } = await service
    .from('hr_payslips')
    .select('gross_satang, tax_satang, sso_satang')
    .eq('user_id', profileId)
    .in('payrun_id', runIds);
  if (slipErr) return { error: 'Failed to load payslips' };

  const cert = buildCert50Twi(profileId, (slips ?? []).map((s) => ({
    employee_id: profileId,
    gross_satang: Number(s.gross_satang) || 0,
    tax_satang: Number(s.tax_satang) || 0,
    sso_satang: Number(s.sso_satang) || 0,
  })));

  const anyRun = (runs ?? [])[0] as { company?: { name?: string; address?: string; tax_id?: string } | null } | undefined;
  return {
    kind: 'cert_50twi',
    year,
    months_count: cert.months_count,
    total_income_satang: cert.total_income_satang,
    total_tax_satang: cert.total_tax_satang,
    total_sso_satang: cert.total_sso_satang,
    company: anyRun?.company ?? null,
  };
}

/** Salary certificate — current employment snapshot (position, start date, monthly rate). */
export async function generateSalaryCert(
  service: SupabaseClient,
  profileId: string
): Promise<GeneratedDoc | { error: string }> {
  const { data: emp, error } = await service
    .from('hr_employees')
    .select('rate_satang, start_date, status, full_name, position:hr_positions(name), company:hr_companies(name, address)')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) return { error: 'Failed to load employee' };
  if (!emp) return { error: 'No employee record' };

  const { data: prof } = await service.from('profiles').select('display_name, username').eq('id', profileId).maybeSingle();
  return {
    kind: 'salary_cert',
    name: (emp.full_name as string | null) || prof?.display_name || prof?.username || '—',
    position: (emp.position as { name?: string } | null)?.name ?? null,
    start_date: emp.start_date ?? null,
    status: emp.status ?? null,
    rate_satang: Number(emp.rate_satang) || 0,
    company: emp.company ?? null,
    issued_date: new Date().toISOString().slice(0, 10),
  };
}
