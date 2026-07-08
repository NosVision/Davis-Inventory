import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// GET /api/hr/ess/imported-payslips — the caller's OWN legacy payslip archive.
// Strictly self-scoped: resolve the caller's hr_employees.id, then return only the
// imported rows that were back-linked to that employee (on identity approval).
const COLS =
  'id, period_year, period_month, name_th, name_en, nickname, position_text, rate_satang,' +
  ' worked_days, off_days, period_days, ot_hours, ot_pay_satang, holiday_pay_satang,' +
  ' transportation_satang, pay_transportation_satang, service_satang, leaves, deduction_satang,' +
  ' deduction_breakdown, gross_satang, sso5_satang, sso3_satang, tax_satang, net_satang';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data: emp } = await service
    .from('hr_employees')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (!emp?.id) return NextResponse.json({ data: [] });

  const { data, error } = await service
    .from('hr_imported_payslips')
    .select(COLS)
    .eq('employee_id', emp.id)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load history' }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
