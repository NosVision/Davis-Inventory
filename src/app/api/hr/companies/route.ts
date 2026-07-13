import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';

const TABLE = 'hr_companies';

// GET /api/hr/companies — the legal entities with their payroll parameters (§A: the engine
// reads sso_rate / sso_wage_ceiling_satang / day_divisor / ot_multipliers per company, so
// editing these IS editing payroll policy — the companies page is the owner's knob panel).
// Selectors that only need id+name keep working; extra fields are additive.
export async function GET() {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .select('id, name, address, tax_id, payslip_paper, sso_rate, sso_wage_ceiling_satang, day_divisor, ot_multipliers, wht_rate, sso_prorate, active, created_at')
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
