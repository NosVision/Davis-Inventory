import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { refusePayrunIfHidden } from '@/lib/hr/payrun-access';
import { logHrAudit } from '@/lib/hr/audit';
import { MAX_ITEM_AMOUNT_SATANG } from '@/lib/hr/recurring';
import { isUniqueViolation } from '@/lib/hr/db-errors';

const TABLE = 'hr_payrun_adjustments';
const COLS = 'id, payrun_id, profile_id, kind, label, amount_satang, reason, created_by, created_at';

// One-off adjustment lines for a payrun (รายการเฉพาะงวด). Owner-approved narrowing of the
// "no manual numbers" rule: HR may APPEND attributed one-off earning/deduction lines with a
// mandatory reason; engine-computed lines stay untouchable. Keyed (payrun, profile) so a draft
// regenerate re-applies them. Draft payruns only; a finalized run is immutable (reopen first).

interface PayrunRow {
  id: string;
  company_id: string;
  store_id: string | null;
  period_year: number;
  period_month: number;
  status: string;
}

async function loadPayrun(service: ReturnType<typeof createServiceClient>, id: string) {
  const { data, error } = await service
    .from('hr_payruns')
    .select('id, company_id, store_id, period_year, period_month, status')
    .eq('id', id)
    .maybeSingle();
  return { payrun: (data as PayrunRow | null) ?? null, error };
}

/** The previous payrun in the same (company, store) bucket, if any. */
async function findPreviousPayrun(service: ReturnType<typeof createServiceClient>, cur: PayrunRow) {
  let q = service
    .from('hr_payruns')
    .select('id, period_year, period_month')
    .eq('company_id', cur.company_id)
    .or(
      `period_year.lt.${cur.period_year},and(period_year.eq.${cur.period_year},period_month.lt.${cur.period_month})`
    )
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false })
    .limit(1);
  q = cur.store_id ? q.eq('store_id', cur.store_id) : q.is('store_id', null);
  const { data } = await q.maybeSingle();
  return (data as { id: string; period_year: number; period_month: number } | null) ?? null;
}

// GET /api/hr/payruns/[id]/adjustments — this run's adjustment rows + the previous run's count
// (feeds the finalize forget-guard: "last period had N adjustments, this one has none").
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();
  const { payrun, error: prErr } = await loadPayrun(service, id);
  if (prErr) return NextResponse.json({ error: 'Failed to load payrun' }, { status: 500 });
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  const auth = await requireHrManagerForStore(payrun.store_id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // §00195: every action on a payrun reaches every slip in it — refuse the whole thing when the
  // caller may not see part of it.
  {
    const refusal = await refusePayrunIfHidden(service, auth.userId, id);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
  }

  const { data: rows, error } = await service
    .from(TABLE)
    .select(COLS)
    .eq('payrun_id', id)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: 'Failed to load adjustments' }, { status: 500 });

  const prev = await findPreviousPayrun(service, payrun);
  let prevCount = 0;
  if (prev) {
    const { count } = await service.from(TABLE).select('id', { count: 'exact', head: true }).eq('payrun_id', prev.id);
    prevCount = count ?? 0;
  }

  return NextResponse.json({
    data: {
      adjustments: rows ?? [],
      previous: prev ? { id: prev.id, period_year: prev.period_year, period_month: prev.period_month, count: prevCount } : null,
    },
  });
}

// POST /api/hr/payruns/[id]/adjustments — add one line. reason is mandatory; the target must
// have a payslip in this run (otherwise the line could never render on any slip).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();
  const { payrun, error: prErr } = await loadPayrun(service, id);
  if (prErr) return NextResponse.json({ error: 'Failed to load payrun' }, { status: 500 });
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  const auth = await requireHrManagerForStore(payrun.store_id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // §00195: every action on a payrun reaches every slip in it — refuse the whole thing when the
  // caller may not see part of it.
  {
    const refusal = await refusePayrunIfHidden(service, auth.userId, id);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
  }
  if (payrun.status !== 'draft') {
    return NextResponse.json({ error: 'Payrun is finalized — reopen it before adding adjustments' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const amount = Number(body.amount_satang);
  if (!profileId) return NextResponse.json({ error: 'profile_id is required' }, { status: 400 });
  if (kind !== 'earning' && kind !== 'deduction') {
    return NextResponse.json({ error: 'kind must be earning or deduction' }, { status: 400 });
  }
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: 'reason is required' }, { status: 400 });
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_ITEM_AMOUNT_SATANG) {
    return NextResponse.json({ error: 'amount_satang must be a positive integer within the allowed range' }, { status: 400 });
  }
  // Self-dealing block: a store-scoped manager (not full HR) must never write a money line onto
  // their OWN payslip — the exact fraud path the "attributed + reasoned" rule cannot audit away.
  if (!auth.fullHr && profileId === auth.userId) {
    return NextResponse.json({ error: 'A store-scoped manager cannot adjust their own payslip' }, { status: 403 });
  }

  const { data: slip, error: slipErr } = await service
    .from('hr_payslips')
    .select('id')
    .eq('payrun_id', id)
    .eq('user_id', profileId)
    .maybeSingle();
  if (slipErr) return NextResponse.json({ error: 'Failed to verify payslip' }, { status: 500 });
  if (!slip) return NextResponse.json({ error: 'Employee has no payslip in this payrun' }, { status: 400 });

  const { data, error } = await service
    .from(TABLE)
    .insert({ payrun_id: id, profile_id: profileId, kind, label, amount_satang: amount, reason, created_by: auth.userId })
    .select(COLS)
    .single();
  if (error) {
    // 00164 dedupe index: an identical line (same person/kind/label/amount) already exists —
    // almost always a double-submit. Vary the label to add a genuine second identical line.
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'An identical adjustment already exists (change the label to add another)' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to add adjustment' }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId, action: 'create', table: TABLE, recordId: data.id as string,
    before: null, after: data, reason: `payrun adjustment added: ${reason}`,
  });
  return NextResponse.json({ data }, { status: 201 });
}

// DELETE /api/hr/payruns/[id]/adjustments?adjustment_id= — remove one line (draft only). Audited.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();
  const { payrun, error: prErr } = await loadPayrun(service, id);
  if (prErr) return NextResponse.json({ error: 'Failed to load payrun' }, { status: 500 });
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  const auth = await requireHrManagerForStore(payrun.store_id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // §00195: every action on a payrun reaches every slip in it — refuse the whole thing when the
  // caller may not see part of it.
  {
    const refusal = await refusePayrunIfHidden(service, auth.userId, id);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
  }
  if (payrun.status !== 'draft') {
    return NextResponse.json({ error: 'Payrun is finalized — reopen it before removing adjustments' }, { status: 409 });
  }

  const adjustmentId = request.nextUrl.searchParams.get('adjustment_id') ?? '';
  if (!adjustmentId) return NextResponse.json({ error: 'adjustment_id is required' }, { status: 400 });

  const { data: before } = await service.from(TABLE).select(COLS).eq('id', adjustmentId).eq('payrun_id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Adjustment not found' }, { status: 404 });
  // Self-dealing block (mirror of POST): a scoped manager must not delete a deduction line
  // that targets themselves either.
  if (!auth.fullHr && (before.profile_id as string) === auth.userId) {
    return NextResponse.json({ error: 'A store-scoped manager cannot adjust their own payslip' }, { status: 403 });
  }

  const { error } = await service.from(TABLE).delete().eq('id', adjustmentId).eq('payrun_id', id);
  if (error) return NextResponse.json({ error: 'Failed to remove adjustment' }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId, action: 'delete', table: TABLE, recordId: adjustmentId,
    before, after: null, reason: 'payrun adjustment removed',
  });
  return NextResponse.json({ data: { id: adjustmentId, removed: true } });
}
