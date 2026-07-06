import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyUser } from '@/lib/notifications/service';

// ④ HR print queue for one payrun: who needs a PAPER slip = everyone with the standing
// "รับกระดาษทุกเดือน" preference + everyone who filed a per-slip request — with printed
// tracking (confidential documents: who printed what, when, must be answerable).

async function authForPayrun(service: ReturnType<typeof createServiceClient>, payrunId: string) {
  const { data: payrun } = await service
    .from('hr_payruns')
    .select('id, store_id, status, period_year, period_month')
    .eq('id', payrunId)
    .maybeSingle();
  if (!payrun) return { payrun: null, auth: null };
  const auth = await requireHrManagerForStore((payrun.store_id as string | null) ?? null);
  return { payrun, auth };
}

// GET /api/hr/payruns/[id]/print-queue
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();
  const { payrun, auth } = await authForPayrun(service, id);
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  if (!auth || !auth.ok) return NextResponse.json({ error: auth?.error ?? 'Forbidden' }, { status: auth?.status ?? 403 });

  const { data: slips, error: slipErr } = await service
    .from('hr_payslips')
    .select('id, user_id, employee_id')
    .eq('payrun_id', id);
  if (slipErr) return NextResponse.json({ error: 'Failed to load payslips' }, { status: 500 });
  const slipList = slips ?? [];
  if (slipList.length === 0) return NextResponse.json({ data: [] });

  const empIds = [...new Set(slipList.map((s) => s.employee_id as string).filter(Boolean))];
  const userIds = [...new Set(slipList.map((s) => s.user_id as string))];
  const [empRes, profRes, reqRes] = await Promise.all([
    service.from('hr_employees').select('id, full_name, paper_slip_standing').in('id', empIds),
    service.from('profiles').select('id, display_name, username').in('id', userIds),
    service.from('hr_payslip_print_requests').select('payslip_id, status, requested_by, printed_at').in('payslip_id', slipList.map((s) => s.id)),
  ]);
  if (empRes.error) return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 });
  const empById = new Map(((empRes.data ?? []) as { id: string; full_name: string | null; paper_slip_standing: boolean }[]).map((e) => [e.id, e]));
  const profById = new Map((profRes.data ?? []).map((p) => [p.id as string, p]));
  const reqBySlip = new Map(((reqRes.data ?? []) as { payslip_id: string; status: string; requested_by: string | null; printed_at: string | null }[]).map((r) => [r.payslip_id, r]));

  const rows = slipList
    .map((s) => {
      const emp = empById.get(s.employee_id as string);
      const req = reqBySlip.get(s.id as string);
      const standing = emp?.paper_slip_standing === true;
      if (!standing && !req) return null; // not in the queue
      const prof = profById.get(s.user_id as string);
      return {
        payslip_id: s.id as string,
        name: emp?.full_name || prof?.display_name || prof?.username || '—',
        source: req?.requested_by ? 'request' : 'standing',
        status: req?.status ?? 'requested',
        printed_at: req?.printed_at ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));

  return NextResponse.json({ data: rows });
}

// POST /api/hr/payruns/[id]/print-queue { payslip_ids } — mark as printed after the physical
// print run; standing entries get a request row created on the spot; employees are told the
// paper slip is ready for pickup.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();
  const { payrun, auth } = await authForPayrun(service, id);
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  if (!auth || !auth.ok) return NextResponse.json({ error: auth?.error ?? 'Forbidden' }, { status: auth?.status ?? 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ids = Array.isArray(body.payslip_ids) ? body.payslip_ids.filter((x): x is string => typeof x === 'string') : [];
  if (ids.length === 0) return NextResponse.json({ error: 'payslip_ids is required' }, { status: 400 });

  // only slips of THIS payrun
  const { data: slips, error: slipErr } = await service
    .from('hr_payslips')
    .select('id, user_id')
    .eq('payrun_id', id)
    .in('id', ids);
  if (slipErr) return NextResponse.json({ error: 'Failed to load payslips' }, { status: 500 });
  const valid = slips ?? [];
  if (valid.length !== ids.length) return NextResponse.json({ error: 'payslip not in this payrun' }, { status: 400 });

  const now = new Date().toISOString();
  for (const s of valid) {
    const { error } = await service
      .from('hr_payslip_print_requests')
      .upsert(
        { payslip_id: s.id, status: 'printed', printed_by: auth.userId, printed_at: now },
        { onConflict: 'payslip_id' }
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: 'hr_payslip_print_requests',
    recordId: id,
    before: null,
    after: { printed: valid.length },
    reason: `Paper slips printed (${valid.length})`,
  });

  const period = `${String(payrun.period_month).padStart(2, '0')}/${payrun.period_year}`;
  await Promise.allSettled(
    valid.map((s) =>
      notifyUser({
        userId: s.user_id as string,
        storeId: (payrun.store_id as string | null) ?? null,
        type: 'hr_paper_ready',
        title: 'สลิปกระดาษพร้อมรับ',
        body: `สลิปเงินเดือนงวด ${period} พิมพ์แล้ว — รับได้ที่ HR`,
        data: { url: '/me/payslips' },
      })
    )
  );

  return NextResponse.json({ data: { printed: valid.length } });
}
