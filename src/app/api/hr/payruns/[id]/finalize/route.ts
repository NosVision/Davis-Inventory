import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { getHrPolicies } from '@/lib/hr/policy';
import { announcePayrun } from '@/lib/hr/announce';

// POST /api/hr/payruns/[id]/finalize — lock a draft payrun (§A: payrun locks after finalize;
// editing requires reopen). HR only, atomic compare-and-set on status='draft' → 409 otherwise.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  // §P5.5: gate on the payrun's store before any mutation.
  const { data: pr, error: prErr } = await service.from('hr_payruns').select('store_id').eq('id', id).maybeSingle();
  if (prErr) return NextResponse.json({ error: 'Failed to finalize payrun' }, { status: 500 });
  if (!pr) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  const auth = await requireHrManagerForStore(pr.store_id as string | null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Defense-in-depth: never finalize an empty payrun. The UI disables the button when there
  // are no payslips, but a direct/replayed POST must be rejected server-side too (finalizing
  // zero slips would lock a meaningless payrun and mark employees "paid" with no slip).
  const { count, error: countErr } = await service
    .from('hr_payslips')
    .select('id', { count: 'exact', head: true })
    .eq('payrun_id', id);
  if (countErr) return NextResponse.json({ error: 'Failed to finalize payrun' }, { status: 500 });
  if (!count) {
    return NextResponse.json({ error: 'Cannot finalize a payrun with no payslips' }, { status: 409 });
  }

  const { data: updated, error } = await service
    .from('hr_payruns')
    .update({ status: 'finalized', finalized_by: auth.userId, finalized_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'draft')
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to finalize payrun' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Payrun not found or already finalized' }, { status: 409 });
  }

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: 'hr_payruns', recordId: id,
    before: { status: 'draft' }, after: { status: 'finalized' }, reason: 'payrun finalized',
  });

  // ⑤ immediate announce mode: push "เงินเดือนออกแล้ว" the moment the run locks (best-effort —
  // a notification failure must never fail the finalize; manual mode = HR presses the button).
  let announced = false;
  try {
    const policies = await getHrPolicies(service);
    if (policies.payslip_announce_mode === 'immediate') {
      const result = await announcePayrun(service, { payrunId: id, actorId: auth.userId });
      announced = result.ok;
    }
  } catch (e) {
    console.error('[finalize] announce failed:', e);
  }

  return NextResponse.json({ data: { id, status: 'finalized', announced } });
}
