import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyHrManagers } from '@/lib/hr/notify';

// POST /api/hr/ess/payslips/[id]/request-paper — the employee asks for a PAPER copy of one of
// their own finalized slips (④: digital is the default; paper on request). Idempotent: an open
// request just returns; an already-printed slip 409s (pick it up at HR instead).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  const { data: slip, error: slipErr } = await service
    .from('hr_payslips')
    .select('id, user_id, payrun_id')
    .eq('id', id)
    .maybeSingle();
  if (slipErr) return NextResponse.json({ error: 'Failed to load payslip' }, { status: 500 });
  if (!slip || slip.user_id !== user.id) return NextResponse.json({ error: 'Payslip not found' }, { status: 404 });

  const { data: payrun } = await service.from('hr_payruns').select('status, store_id, period_year, period_month').eq('id', slip.payrun_id).maybeSingle();
  if (!payrun || payrun.status !== 'finalized') {
    return NextResponse.json({ error: 'Slip not finalized yet' }, { status: 409 });
  }

  const { data: existing } = await service
    .from('hr_payslip_print_requests')
    .select('id, status')
    .eq('payslip_id', id)
    .maybeSingle();
  if (existing?.status === 'printed') {
    return NextResponse.json({ error: 'Already printed — pick it up at HR' }, { status: 409 });
  }
  if (existing) {
    return NextResponse.json({ data: { id: existing.id, status: existing.status, already: true } });
  }

  const { data: created, error: insErr } = await service
    .from('hr_payslip_print_requests')
    .insert({ payslip_id: id, requested_by: user.id })
    .select('id, status')
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  try {
    const { data: prof } = await service.from('profiles').select('display_name, username').eq('id', user.id).maybeSingle();
    const period = `${String(payrun.period_month).padStart(2, '0')}/${payrun.period_year}`;
    await notifyHrManagers(service, {
      storeId: (payrun.store_id as string | null) ?? null,
      type: 'hr_paper_request',
      title: 'ขอสลิปกระดาษ',
      body: `${prof?.display_name || prof?.username || 'พนักงาน'} ขอสลิปกระดาษ งวด ${period}`,
      data: { payslip_id: id, url: '/hr/payroll' },
      excludeUserId: user.id,
    });
  } catch (e) {
    console.error('[request-paper] notify failed:', e);
  }

  return NextResponse.json({ data: { id: created.id, status: created.status } }, { status: 201 });
}
