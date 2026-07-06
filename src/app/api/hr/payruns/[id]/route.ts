import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
}

// GET /api/hr/payruns/[id] — a payrun with its per-employee payslip summaries (HR only).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: payrun, error: prErr } = await service
    .from('hr_payruns')
    .select('id, company_id, store_id, period_year, period_month, cycle_start, cycle_end, pay_date, status, finalized_at, note, announced_at')
    .eq('id', id)
    .maybeSingle();
  if (prErr) return NextResponse.json({ error: 'Failed to load payrun' }, { status: 500 });
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });

  // §P5.5: a store-scoped payrun is reachable by a manager of that store; company-wide (NULL) is full-HR only.
  const auth = await requireHrManagerForStore(payrun.store_id as string | null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data: slips, error: slErr } = await service
    .from('hr_payslips')
    .select('id, user_id, employee_id, rate_satang, pay_type, tax_mode, worked_days, gross_satang, sso_satang, tax_satang, total_deduction_satang, net_satang')
    .eq('payrun_id', id);
  if (slErr) return NextResponse.json({ error: 'Failed to load payslips' }, { status: 500 });

  const slipRows = slips ?? [];
  const userIds = [...new Set(slipRows.map((s) => s.user_id))];
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const { data: profs } = await service.from('profiles').select('id, username, display_name').in('id', userIds);
    for (const p of (profs ?? []) as ProfileRow[]) nameById.set(p.id, p.display_name || p.username || '—');
  }

  const payslips = slipRows
    .map((s) => ({ ...s, name: nameById.get(s.user_id) ?? '—' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const totals = payslips.reduce(
    (acc, s) => ({
      gross: acc.gross + s.gross_satang,
      net: acc.net + s.net_satang,
      sso: acc.sso + s.sso_satang,
      tax: acc.tax + s.tax_satang,
    }),
    { gross: 0, net: 0, sso: 0, tax: 0 }
  );

  return NextResponse.json({ data: { payrun, payslips, totals } });
}
