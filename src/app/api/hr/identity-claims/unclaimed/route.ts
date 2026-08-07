import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';

/**
 * GET /api/hr/identity-claims/unclaimed?q=&company_id=
 *
 * The imported sheet names that are still waiting for a person: rows in hr_pending_identities
 * that nobody has claimed. These people exist in payroll but have no employee record, so they
 * cannot appear in a payrun — and most of them never knew their name was sitting here (owner
 * ask 2026-08-07). Returns enough detail for HR to recognise each one, plus the candidate
 * accounts to link against.
 */
const SEARCH_CAP = 300;

export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = request.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').trim();
  const companyId = sp.get('company_id');

  const service = createServiceClient();

  let query = service
    .from('hr_pending_identities')
    .select(
      'id, full_name_th, full_name_en, position_text, employee_code, rate_satang, pay_type, ' +
        'start_date, sheet_ref, status, claimed_at, ' +
        'company:hr_companies(id, name), store:stores(id, store_name), ' +
        'claimant:profiles!hr_pending_identities_claimed_by_fkey(id, username, display_name)'
    )
    .eq('status', 'unclaimed');
  if (companyId) query = query.eq('company_id', companyId);
  if (q) query = query.or(`full_name_th.ilike.%${q}%,full_name_en.ilike.%${q}%,employee_code.ilike.%${q}%`);
  query = query.order('full_name_th').limit(SEARCH_CAP);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to load unclaimed identities' }, { status: 500 });

  // Accounts HR can link to: any active non-customer login that has NO employee record yet.
  // Anyone already linked is excluded, so the picker can't offer an impossible target.
  const [{ data: profiles }, { data: linked }] = await Promise.all([
    service
      .from('profiles')
      .select('id, username, display_name, role, created_at')
      .neq('role', 'customer')
      .eq('active', true)
      .order('created_at', { ascending: false }),
    service.from('hr_employees').select('profile_id'),
  ]);

  const takenIds = new Set((linked ?? []).map((e) => e.profile_id as string));
  const candidates = (profiles ?? [])
    .filter((p) => !takenIds.has(p.id as string))
    .filter((p) => !String(p.username ?? '').startsWith('printer-'))
    .map((p) => ({
      id: p.id as string,
      username: p.username as string,
      display_name: (p.display_name as string | null) ?? null,
      role: p.role as string,
    }));

  return NextResponse.json({
    data: {
      identities: data ?? [],
      candidates,
      counts: { unclaimed: (data ?? []).length, candidates: candidates.length },
    },
  });
}
