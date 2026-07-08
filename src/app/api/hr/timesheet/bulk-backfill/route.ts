import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { enumerateDates } from '@/lib/hr/leaves';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TABLE = 'hr_timesheet_overrides';
const DEFAULT_WORK_HOURS = 9; // §A default when hr_employees.work_hours_per_day is null
const DEFAULT_LATE_MIN = 30;
const MAX_CELLS = 3000; // employees × days guard

type Status = 'normal' | 'absent' | 'leave' | 'late' | 'dayoff';
const STATUSES: Status[] = ['normal', 'absent', 'leave', 'late', 'dayoff'];

function isCalendarDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

// Map a coarse status to the derived-timesheet override fields (owner mapping 2026-07-08).
function fieldsFor(status: Status, fullDayMin: number, lateMin: number) {
  switch (status) {
    case 'absent': return { worked_min: 0, late_min: 0, absent: true };
    case 'leave': return { worked_min: fullDayMin, late_min: 0, absent: false };
    case 'late': return { worked_min: fullDayMin, late_min: Math.min(lateMin, fullDayMin), absent: false };
    case 'dayoff': return { worked_min: 0, late_min: 0, absent: false };
    case 'normal':
    default: return { worked_min: fullDayMin, late_min: 0, absent: false };
  }
}

// POST /api/hr/timesheet/bulk-backfill — fill a whole branch's timesheet for a date range in one
// shot (owner ask 2026-07-08), for a period with no punch data. Writes hr_timesheet_overrides for
// every active employee in the store × every day in [date_from, date_to] with the chosen status.
// By default it only fills GAPS (skips days that already have an override) so real data is safe;
// `overwrite:true` replaces existing rows. Store-manager/HR gated; audited as a single summary.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const dateFrom = typeof body.date_from === 'string' ? body.date_from : '';
  const dateTo = typeof body.date_to === 'string' ? body.date_to : '';
  const status = STATUSES.includes(body.status as Status) ? (body.status as Status) : null;
  const lateMin = typeof body.late_min === 'number' && body.late_min >= 0 ? Math.floor(body.late_min) : DEFAULT_LATE_MIN;
  const overwrite = body.overwrite === true;
  const userIdsFilter = Array.isArray(body.user_ids) ? body.user_ids.filter((u): u is string => typeof u === 'string') : null;

  if (!storeId) return NextResponse.json({ error: 'store_id is required' }, { status: 400 });
  if (!isCalendarDate(dateFrom) || !isCalendarDate(dateTo)) {
    return NextResponse.json({ error: 'valid date_from and date_to are required' }, { status: 400 });
  }
  if (dateFrom > dateTo) return NextResponse.json({ error: 'date_from must be on or before date_to' }, { status: 400 });
  if (!status) return NextResponse.json({ error: 'invalid status' }, { status: 400 });

  const auth = await requireStoreManager(storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();

  // Active employees assigned to this store (optionally a caller-supplied subset).
  const { data: usRows, error: usErr } = await service.from('user_stores').select('user_id').eq('store_id', storeId);
  if (usErr) return NextResponse.json({ error: 'Failed to load store members' }, { status: 500 });
  let memberIds = [...new Set((usRows ?? []).map((r) => r.user_id as string))];
  if (userIdsFilter) memberIds = memberIds.filter((id) => userIdsFilter.includes(id));
  if (memberIds.length === 0) return NextResponse.json({ data: { employees: 0, days: 0, written: 0, skipped: 0 } });

  const { data: emps, error: empErr } = await service
    .from('hr_employees')
    .select('profile_id, work_hours_per_day, status')
    .in('profile_id', memberIds)
    .in('status', ['active', 'probation']);
  if (empErr) return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 });
  const employees = (emps ?? []) as { profile_id: string; work_hours_per_day: number | null }[];
  if (employees.length === 0) return NextResponse.json({ data: { employees: 0, days: 0, written: 0, skipped: 0 } });

  const dates = enumerateDates(dateFrom, dateTo);
  if (employees.length * dates.length > MAX_CELLS) {
    return NextResponse.json({ error: `Too many cells (${employees.length} employees × ${dates.length} days). Narrow the range.` }, { status: 400 });
  }

  // Gap-fill by default: skip (employee, date) pairs that already have an override.
  const existing = new Set<string>();
  if (!overwrite) {
    const { data: ex } = await service
      .from(TABLE)
      .select('user_id, business_date')
      .in('user_id', employees.map((e) => e.profile_id))
      .gte('business_date', dateFrom)
      .lte('business_date', dateTo);
    for (const r of ex ?? []) existing.add(`${r.user_id}|${r.business_date}`);
  }

  const reason = `Bulk backfill: ${status}`;
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const e of employees) {
    const fullDayMin = Math.round((e.work_hours_per_day ?? DEFAULT_WORK_HOURS) * 60);
    const f = fieldsFor(status, fullDayMin, lateMin);
    for (const d of dates) {
      if (!overwrite && existing.has(`${e.profile_id}|${d}`)) { skipped++; continue; }
      rows.push({
        user_id: e.profile_id,
        business_date: d,
        store_id: storeId,
        worked_min: f.worked_min,
        late_min: f.late_min,
        ot_min: null,
        absent: f.absent,
        reason,
        edited_by: auth.userId,
      });
    }
  }

  if (rows.length > 0) {
    const { error } = await service.from(TABLE).upsert(rows, { onConflict: 'user_id,business_date' });
    if (error) return NextResponse.json({ error: 'Failed to write timesheet' }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: storeId,
    before: null,
    after: { status, date_from: dateFrom, date_to: dateTo, written: rows.length, skipped, overwrite },
    reason: `Bulk backfill ${status}: ${rows.length} cells (${employees.length} employees × ${dates.length} days)`,
  });

  return NextResponse.json({ data: { employees: employees.length, days: dates.length, written: rows.length, skipped } });
}
