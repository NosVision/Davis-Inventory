import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// Fields the employee leave-filing form needs (§D) — no HR-only config exposed.
const SELECT =
  'id, code, name_th, name_en, requires_cert, advance_notice_days, probational_allowed, paid';

// GET /api/hr/ess/leave-types — ACTIVE leave types the CALLER can file against.
// Auth-any (not HR-gated). Scoped to the caller's company plus any global
// (company_id IS NULL) types, ordered by sort_order.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();

  // Find the caller's company so they only see their own company's leave types.
  const { data: emp } = await service
    .from('hr_employees')
    .select('company_id')
    .eq('profile_id', user.id)
    .maybeSingle();

  let query = service.from('hr_leave_types').select(SELECT).eq('active', true);
  const companyId = emp?.company_id as string | null | undefined;
  if (companyId) {
    query = query.or(`company_id.eq.${companyId},company_id.is.null`);
  } else {
    query = query.is('company_id', null);
  }
  query = query.order('sort_order', { ascending: true });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to load leave types' }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
