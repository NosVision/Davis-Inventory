import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_payrun_adjustments';

// POST /api/hr/payruns/[id]/adjustments/copy-from-previous — pre-fill this draft's adjustments
// from the previous payrun (the "กยศ recurs, only the amount changes" monthly flow: copy, then
// edit deltas). Skips people with no payslip in this run and exact duplicates already present.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: payrun, error: prErr } = await service
    .from('hr_payruns')
    .select('id, company_id, store_id, period_year, period_month, status')
    .eq('id', id)
    .maybeSingle();
  if (prErr) return NextResponse.json({ error: 'Failed to load payrun' }, { status: 500 });
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  const auth = await requireHrManagerForStore(payrun.store_id as string | null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (payrun.status !== 'draft') {
    return NextResponse.json({ error: 'Payrun is finalized' }, { status: 409 });
  }

  // Previous payrun in the same (company, store) bucket.
  let q = service
    .from('hr_payruns')
    .select('id, period_year, period_month')
    .eq('company_id', payrun.company_id as string)
    .or(
      `period_year.lt.${payrun.period_year},and(period_year.eq.${payrun.period_year},period_month.lt.${payrun.period_month})`
    )
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false })
    .limit(1);
  q = payrun.store_id ? q.eq('store_id', payrun.store_id as string) : q.is('store_id', null);
  const { data: prev } = await q.maybeSingle();
  if (!prev) return NextResponse.json({ error: 'No previous payrun to copy from' }, { status: 404 });

  const [{ data: prevAdj, error: prevErr }, { data: curAdj, error: curErr }, { data: slips, error: slipErr }] =
    await Promise.all([
      service.from(TABLE).select('profile_id, kind, label, amount_satang, reason').eq('payrun_id', prev.id as string),
      service.from(TABLE).select('profile_id, kind, label, amount_satang').eq('payrun_id', id),
      service.from('hr_payslips').select('user_id').eq('payrun_id', id),
    ]);
  if (prevErr || curErr || slipErr) {
    return NextResponse.json({ error: 'Failed to load adjustments' }, { status: 500 });
  }
  if (!prevAdj || prevAdj.length === 0) {
    return NextResponse.json({ data: { copied: 0, skipped: 0 } });
  }

  const inRun = new Set((slips ?? []).map((s) => s.user_id as string));
  const existing = new Set(
    (curAdj ?? []).map((a) => `${a.profile_id}|${a.kind}|${a.label}|${a.amount_satang}`)
  );

  const rows = [];
  let skipped = 0;
  for (const a of prevAdj as { profile_id: string; kind: string; label: string; amount_satang: number; reason: string }[]) {
    if (!inRun.has(a.profile_id) || existing.has(`${a.profile_id}|${a.kind}|${a.label}|${a.amount_satang}`)) {
      skipped++;
      continue;
    }
    rows.push({
      payrun_id: id,
      profile_id: a.profile_id,
      kind: a.kind,
      label: a.label,
      amount_satang: a.amount_satang,
      reason: a.reason,
      created_by: auth.userId,
    });
  }

  if (rows.length > 0) {
    const { error } = await service.from(TABLE).insert(rows);
    if (error) return NextResponse.json({ error: 'Failed to copy adjustments' }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId, action: 'create', table: TABLE, recordId: id,
    before: null, after: { from_payrun: prev.id, copied: rows.length, skipped },
    reason: `adjustments copied from previous payrun (${prev.period_year}-${prev.period_month})`,
  });
  return NextResponse.json({ data: { copied: rows.length, skipped } });
}
