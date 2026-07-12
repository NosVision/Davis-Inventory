import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// GET /api/hr/ess/identity/options?q= — UNCLAIMED real names the employee can pick as "me".
// Names + venue hint only (the staging rows carry salary seed data — those columns never leave
// the server here). Requires 2+ chars so the full roster is never dumped to a client.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ data: [] });

  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_pending_identities')
    .select('id, full_name_th, bank_account_no, store:stores(store_name)')
    .eq('status', 'unclaimed')
    .ilike('full_name_th', `%${q.replace(/[%_]/g, '')}%`)
    .order('full_name_th')
    .limit(12);
  if (error) return NextResponse.json({ error: 'Failed to search names' }, { status: 500 });

  // Only reveal WHETHER a bank number will be required at claim time — never the bank name or
  // last digits. Leaking those let any authenticated user enumerate payroll PII and narrow a
  // brute-force of the claim's full-account second factor. The real person knows their own account.
  const rows = (data ?? []).map((r) => {
    const acct = (r.bank_account_no as string | null) ?? '';
    return {
      id: r.id as string,
      full_name_th: r.full_name_th as string,
      store_name: ((r.store as { store_name?: string } | null)?.store_name as string) ?? null,
      requires_bank_verify: acct.length >= 4,
    };
  });
  return NextResponse.json({ data: rows });
}
