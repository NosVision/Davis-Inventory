import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireSchedulerForScope } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { buildCopyPlan, monthDates, type CopySourceRow } from '@/lib/hr/schedule-copy';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * POST /api/hr/schedule/copy-month — fill a store's month from the month before it.
 *
 * The office works the same days every month and re-entering that by hand is the task this
 * removes (owner ask 2026-08-28). Never overwrites: anyone who already has a row in the target
 * month is skipped whole, so this is safe to press twice.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const fromMonth = typeof body.from_month === 'string' ? body.from_month : '';
  const toMonth = typeof body.to_month === 'string' ? body.to_month : '';

  if (!storeId) return NextResponse.json({ error: 'store_id is required' }, { status: 400 });
  if (!MONTH_RE.test(fromMonth) || !MONTH_RE.test(toMonth)) {
    return NextResponse.json({ error: 'from_month and to_month must be YYYY-MM' }, { status: 400 });
  }
  if (fromMonth === toMonth) {
    return NextResponse.json({ error: 'from_month and to_month must differ' }, { status: 400 });
  }

  const auth = await requireSchedulerForScope(storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const fromDates = monthDates(fromMonth);
  const toDates = monthDates(toMonth);

  const [srcRes, dstRes] = await Promise.all([
    service
      .from('hr_schedule')
      .select('user_id, work_date, shift_template_id, is_day_off')
      .eq('store_id', storeId)
      .gte('work_date', fromDates[0])
      .lte('work_date', fromDates[fromDates.length - 1]),
    service
      .from('hr_schedule')
      .select('user_id')
      .eq('store_id', storeId)
      .gte('work_date', toDates[0])
      .lte('work_date', toDates[toDates.length - 1]),
  ]);
  if (srcRes.error || dstRes.error) {
    return NextResponse.json({ error: 'Failed to read the roster' }, { status: 500 });
  }

  const skip = new Set((dstRes.data ?? []).map((r) => r.user_id as string));
  const plan = buildCopyPlan((srcRes.data ?? []) as CopySourceRow[], toMonth, skip);
  if (plan.length === 0) {
    return NextResponse.json({
      data: { filled_cells: 0, filled_people: 0, skipped_people: skip.size },
    });
  }

  // status 'draft' like every hand edit: a copied month still has to be published.
  const { error: insErr } = await service.from('hr_schedule').insert(
    plan.map((c) => ({
      store_id: storeId,
      company_id: null,
      user_id: c.user_id,
      work_date: c.work_date,
      shift_template_id: c.shift_template_id,
      is_day_off: c.is_day_off,
      status: 'draft',
      created_by: auth.userId,
    }))
  );
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const people = new Set(plan.map((c) => c.user_id));
  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: 'hr_schedule',
    recordId: storeId,
    before: null,
    after: { from_month: fromMonth, to_month: toMonth, cells: plan.length, people: people.size },
    reason: `คัดลอกตารางกะ ${fromMonth} → ${toMonth} (${people.size} คน ${plan.length} ช่อง)`,
  });

  return NextResponse.json({
    data: { filled_cells: plan.length, filled_people: people.size, skipped_people: skip.size },
  });
}
