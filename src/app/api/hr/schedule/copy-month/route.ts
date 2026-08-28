import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireSchedulerForScope } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isRangeInFinalizedPeriod, FINALIZED_PERIOD_ERROR } from '@/lib/hr/period-lock';
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
  if (toMonth <= fromMonth) {
    return NextResponse.json(
      { error: 'เดือนปลายทางต้องอยู่หลังเดือนต้นทาง' },
      { status: 400 }
    );
  }

  const auth = await requireSchedulerForScope(storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const fromDates = monthDates(fromMonth);
  const toDates = monthDates(toMonth);

  // §Phase 0B: don't let a finalized (possibly paid) period's roster be edited after the fact.
  // Copy spans the entire target month for this store, so check the range.
  try {
    if (await isRangeInFinalizedPeriod(service, toDates[0], toDates[toDates.length - 1], [storeId])) {
      return NextResponse.json({ error: FINALIZED_PERIOD_ERROR }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ error: 'Failed to verify pay period' }, { status: 500 });
  }

  const [srcRes, dstRes, empRes] = await Promise.all([
    service
      .from('hr_schedule')
      .select('user_id, work_date, shift_template_id, is_day_off')
      .eq('store_id', storeId)
      .gte('work_date', fromDates[0])
      .lte('work_date', fromDates[fromDates.length - 1]),
    // Skip-set check: hr_schedule is unique on (user_id, work_date) regardless of store.
    // Remove store filter to catch rows at any store for the same person and date.
    service
      .from('hr_schedule')
      .select('user_id')
      .gte('work_date', toDates[0])
      .lte('work_date', toDates[toDates.length - 1]),
    // Load employee records to check for inactive status and employment end dates.
    service.from('hr_employees').select('profile_id, status, end_date'),
  ]);
  if (srcRes.error || dstRes.error || empRes.error) {
    return NextResponse.json({ error: 'Failed to read the roster' }, { status: 500 });
  }

  const skip = new Set((dstRes.data ?? []).map((r) => r.user_id as string));
  const plan = buildCopyPlan((srcRes.data ?? []) as CopySourceRow[], toMonth, skip);

  // Filter plan: drop cells for inactive people or past their end_date.
  const empByProfile = new Map(
    ((empRes.data ?? []) as { profile_id: string; status: string | null; end_date: string | null }[]).map((e) => [
      e.profile_id,
      e,
    ])
  );
  let skippedInactive = 0;
  const filtered = plan.filter((cell) => {
    const emp = empByProfile.get(cell.user_id);
    if (!emp) return true; // No employee record found, pass through (edge case)
    // Drop resigned/terminated people past their employment end date.
    if (
      (emp.status === 'resigned' || emp.status === 'terminated') &&
      (!emp.end_date || cell.work_date > emp.end_date)
    ) {
      skippedInactive++;
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    return NextResponse.json({
      data: {
        filled_cells: 0,
        filled_people: 0,
        skipped_people: skip.size,
        skipped_inactive: skippedInactive,
      },
    });
  }

  // status 'draft' like every hand edit: a copied month still has to be published.
  // Do NOT use upsert with onConflict: upsert would silently overwrite another store's
  // row for the same person and date, violating the constraint that each day belongs
  // to one venue. Copy-month must reject or skip, never take away from another store.
  const { error: insErr } = await service.from('hr_schedule').insert(
    filtered.map((c) => ({
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
  if (insErr) {
    // Postgres unique constraint violation (23505): a row already exists for this (user_id, work_date).
    // The skip-set should have caught this, but a concurrent insert could race us. Tell the caller
    // to reload and try again.
    if (insErr.code === '23505') {
      return NextResponse.json(
        { error: 'ตารางมีการเปลี่ยนแปลง — โหลดใหม่แล้วลองอีกครั้ง' },
        { status: 409 }
      );
    }
    // Generic insert error — hide raw Postgres text and return a Thai message.
    return NextResponse.json({ error: 'บันทึกตารางกะไม่สำเร็จ' }, { status: 500 });
  }

  const people = new Set(filtered.map((c) => c.user_id));
  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: 'hr_schedule',
    recordId: storeId,
    before: null,
    after: {
      from_month: fromMonth,
      to_month: toMonth,
      cells: filtered.length,
      people: people.size,
      skipped_inactive: skippedInactive,
    },
    reason: `คัดลอกตารางกะ ${fromMonth} → ${toMonth} (${people.size} คน ${filtered.length} ช่อง)`,
  });

  return NextResponse.json({
    data: {
      filled_cells: filtered.length,
      filled_people: people.size,
      skipped_people: skip.size,
      skipped_inactive: skippedInactive,
    },
  });
}
