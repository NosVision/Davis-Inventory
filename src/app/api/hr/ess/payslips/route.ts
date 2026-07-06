import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// GET /api/hr/ess/payslips — the caller's OWN payslips from FINALIZED payruns only
// (an employee should not see a draft, still-changing slip). Auth-any, strictly self-scoped.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  // Two-step (not an embedded !inner filter): fetch the caller's slips, then keep only
  // those whose payrun is FINALIZED. An embedded-resource filter (`payrun.status=eq…` on
  // `hr_payruns!inner`) hangs the PostgREST planner here, so we join in JS instead.
  const { data: slipRows, error: slipErr } = await service
    .from('hr_payslips')
    .select('id, payrun_id, gross_satang, net_satang, sso_satang, tax_satang')
    .eq('user_id', user.id);
  if (slipErr) return NextResponse.json({ error: 'Failed to load payslips' }, { status: 500 });

  const slips = slipRows ?? [];
  if (slips.length === 0) return NextResponse.json({ data: [] });

  const payrunIds = [...new Set(slips.map((s) => s.payrun_id))];
  const { data: runRows, error: runErr } = await service
    .from('hr_payruns')
    .select('id, period_year, period_month, pay_date, status')
    .in('id', payrunIds)
    .eq('status', 'finalized');
  if (runErr) return NextResponse.json({ error: 'Failed to load payslips' }, { status: 500 });

  // paper-slip request status per slip + the caller's standing preference (④ print queue)
  const [reqRes, empRes] = await Promise.all([
    service.from('hr_payslip_print_requests').select('payslip_id, status').in('payslip_id', slips.map((s) => s.id)),
    service.from('hr_employees').select('paper_slip_standing').eq('profile_id', user.id).maybeSingle(),
  ]);
  const reqBySlip = new Map(((reqRes.data ?? []) as { payslip_id: string; status: string }[]).map((r) => [r.payslip_id, r.status]));

  const runById = new Map((runRows ?? []).map((r) => [r.id, r]));
  const out = slips
    .filter((s) => runById.has(s.payrun_id))
    .map((s) => {
      const r = runById.get(s.payrun_id)!;
      return {
        id: s.id,
        gross_satang: s.gross_satang,
        net_satang: s.net_satang,
        sso_satang: s.sso_satang,
        tax_satang: s.tax_satang,
        period_year: r.period_year,
        period_month: r.period_month,
        pay_date: r.pay_date,
        paper_status: reqBySlip.get(s.id as string) ?? null,
      };
    })
    .sort((a, b) => b.period_year - a.period_year || b.period_month - a.period_month);

  return NextResponse.json({ data: out, paper_slip_standing: empRes.data?.paper_slip_standing ?? false });
}
