import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';

// GET /api/hr/payslips/[id] — one payslip with its itemized earning + deduction lines.
// Readable by the employee it belongs to (own slip), by company-wide HR, or by a manager scoped
// to the payrun's store (§P5.5). Auth-any at the edge; ownership/scope is enforced explicitly so
// the ESS slip view can reuse this endpoint.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  const { data: slip, error: slErr } = await service
    .from('hr_payslips')
    .select('id, payrun_id, user_id, employee_id, rate_satang, pay_type, tax_mode, worked_days, gross_satang, sso_satang, tax_satang, total_deduction_satang, net_satang')
    .eq('id', id)
    .maybeSingle();
  if (slErr) return NextResponse.json({ error: 'Failed to load payslip' }, { status: 500 });
  if (!slip) return NextResponse.json({ error: 'Payslip not found' }, { status: 404 });

  // Ownership/scope gate: an employee sees only their own; otherwise the caller must be HR for the
  // payrun's store (company-wide HR, or a manager scoped to a store-scoped payrun's store).
  if (slip.user_id !== user.id) {
    const { data: pr } = await service.from('hr_payruns').select('store_id').eq('id', slip.payrun_id).maybeSingle();
    const auth = await requireHrManagerForStore((pr?.store_id as string | null | undefined) ?? null);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [earnRes, dedRes, payrunRes, profRes, ovrRes, empRes] = await Promise.all([
    service.from('hr_payslip_earnings').select('type, label, amount_satang, ref, sort').eq('payslip_id', id).order('sort'),
    service.from('hr_payslip_deductions').select('type, label, amount_satang, reason, ref, sort').eq('payslip_id', id).order('sort'),
    service.from('hr_payruns').select('id, company_id, period_year, period_month, cycle_start, cycle_end, pay_date, status, company:hr_companies(name, address)').eq('id', slip.payrun_id).maybeSingle(),
    service.from('profiles').select('username, display_name').eq('id', slip.user_id).maybeSingle(),
    service.from('hr_payslip_tax_overrides').select('tax_satang, note, set_via, updated_at').eq('payrun_id', slip.payrun_id).eq('profile_id', slip.user_id).maybeSingle(),
    // slip-form print header fields (§ dot-matrix form): code / formal name / bank account
    service.from('hr_employees').select('employee_code, full_name, bank_account_no').eq('id', (slip.employee_id as string) ?? '00000000-0000-0000-0000-000000000000').maybeSingle(),
  ]);
  if (earnRes.error || dedRes.error) {
    return NextResponse.json({ error: 'Failed to load payslip lines' }, { status: 500 });
  }

  const emp = empRes.data as { employee_code: string | null; full_name: string | null; bank_account_no: string | null } | null;
  const employeeName = emp?.full_name || profRes.data?.display_name || profRes.data?.username || '—';
  const nickname = profRes.data?.display_name && profRes.data.display_name !== employeeName ? profRes.data.display_name : null;
  return NextResponse.json({
    data: {
      payslip: {
        ...slip,
        employee_name: employeeName,
        employee_code: emp?.employee_code ?? null,
        nickname,
        bank_account_no: emp?.bank_account_no ?? null,
      },
      payrun: payrunRes.data ?? null,
      earnings: earnRes.data ?? [],
      deductions: dedRes.data ?? [],
      // official figure from the accounting office (null = engine estimate is in effect)
      tax_override: ovrRes.data ?? null,
    },
  });
}
