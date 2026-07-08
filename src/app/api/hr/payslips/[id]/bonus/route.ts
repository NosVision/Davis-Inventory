import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

// PUT /api/hr/payslips/[id]/bonus { amount_satang, label? } — HR one-time bonus for this employee
// on this payrun. Keyed by (payrun, profile) so a draft regenerate re-applies it via the engine
// (which folds it into gross → 3% tax → net correctly). amount 0 clears the bonus. Draft only;
// the caller regenerates the payrun after saving. Scoped + audited like the tax-override route.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: slip } = await service.from('hr_payslips').select('payrun_id, user_id').eq('id', id).maybeSingle();
  if (!slip) return NextResponse.json({ error: 'Payslip not found' }, { status: 404 });
  const { data: pr } = await service.from('hr_payruns').select('store_id, status').eq('id', slip.payrun_id).maybeSingle();
  if (!pr) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  const auth = await requireHrManagerForStore((pr.store_id as string | null | undefined) ?? null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (pr.status !== 'draft') {
    return NextResponse.json({ error: 'Payrun is finalized — reopen it before changing bonus' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const amount = Math.round(Number(body.amount_satang));
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000_00) {
    return NextResponse.json({ error: 'amount_satang must be 0–100,000,000' }, { status: 400 });
  }
  const label = typeof body.label === 'string' && body.label.trim() !== '' ? body.label.trim().slice(0, 120) : null;

  if (amount === 0) {
    const { error } = await service
      .from('hr_payslip_bonuses')
      .delete()
      .eq('payrun_id', slip.payrun_id)
      .eq('profile_id', slip.user_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await service.from('hr_payslip_bonuses').upsert(
      {
        payrun_id: slip.payrun_id,
        profile_id: slip.user_id,
        amount_satang: amount,
        label,
        set_by: auth.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'payrun_id,profile_id' }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: 'hr_payslip_bonuses',
    recordId: slip.payrun_id,
    before: null,
    after: { profile_id: slip.user_id, amount_satang: amount, label },
    reason: `Bonus ${amount === 0 ? 'cleared' : `set ${(amount / 100).toFixed(2)}`}`,
  });

  return NextResponse.json({ data: { amount_satang: amount, label } });
}
