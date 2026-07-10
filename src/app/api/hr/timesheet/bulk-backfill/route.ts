import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { enumerateDates } from '@/lib/hr/leaves';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TABLE = 'hr_timesheet_overrides';
const DEFAULT_WORK_HOURS = 9; // §A default when hr_employees.work_hours_per_day is null
const DEFAULT_LATE_MIN = 30;
const MAX_CELLS = 4000; // employees × days guard

type Status = 'normal' | 'absent' | 'leave' | 'late' | 'dayoff';
const STATUSES: Status[] = ['normal', 'absent', 'leave', 'late', 'dayoff'];
const CELL_STATUSES = [...STATUSES, 'clear'] as const;

function isCalendarDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}
const nameOf = (p: { display_name?: string | null; username?: string | null } | null) =>
  p?.display_name || p?.username || '—';
const intOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

// A cell's coarse status + optional late/OT minutes → the derived-timesheet override fields
// (owner mapping 2026-07-08). absent/dayoff = worked 0; everything else = a full working day, with
// late & OT layered on top so the derived timesheet (and therefore pay) recomputes.
function fieldsForCell(status: Status, fullDayMin: number, lateMin: number | null, otMin: number | null) {
  const working = status !== 'absent' && status !== 'dayoff';
  return {
    worked_min: working ? fullDayMin : 0,
    late_min: working ? Math.min(lateMin ?? 0, fullDayMin) : 0,
    ot_min: working && (otMin ?? 0) > 0 ? otMin : null,
    absent: status === 'absent',
  };
}

// Best-effort reverse map so the grid shows whatever override already exists on a day.
function cellFromOverride(o: { worked_min: number | null; late_min: number | null; ot_min: number | null; absent: boolean | null; reason: string | null }) {
  let status: Status = 'normal';
  const m = /Bulk backfill: (\w+)/.exec(o.reason ?? '');
  if (m && (STATUSES as string[]).includes(m[1])) status = m[1] as Status;
  else if (o.absent) status = 'absent';
  else if ((o.worked_min ?? 0) === 0) status = 'dayoff';
  else if ((o.late_min ?? 0) > 0) status = 'late';
  else if (/leave/i.test(o.reason ?? '')) status = 'leave';
  return { status, late: o.late_min ?? 0, ot: o.ot_min ?? 0 };
}

// GET /api/hr/timesheet/bulk-backfill?store_id=&from=&to= — grid seed: the store's active employees
// plus each existing override cell (status + late + OT) in the range (owner ask 2026-07-08).
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeId = sp.get('store_id') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  if (!storeId) return NextResponse.json({ error: 'store_id is required' }, { status: 400 });
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) {
    return NextResponse.json({ error: 'valid from/to are required' }, { status: 400 });
  }
  const auth = await requireStoreManager(storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data: usRows, error: usErr } = await service.from('user_stores').select('user_id').eq('store_id', storeId);
  if (usErr) return NextResponse.json({ error: 'Failed to load store members' }, { status: 500 });
  const memberIds = [...new Set((usRows ?? []).map((r) => r.user_id as string))];
  if (memberIds.length === 0) return NextResponse.json({ data: { employees: [], cells: {} } });

  const { data: emps, error: empErr } = await service
    .from('hr_employees')
    .select('profile_id, full_name, profile:profiles!hr_employees_profile_id_fkey(display_name, username)')
    .in('profile_id', memberIds)
    .in('status', ['active', 'probation']);
  if (empErr) return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 });
  const employees = (emps ?? [])
    .map((e) => ({
      user_id: e.profile_id as string,
      name: (e.full_name as string | null)?.trim() || nameOf(e.profile as never),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const { data: ovs } = await service
    .from(TABLE)
    .select('user_id, business_date, worked_min, late_min, ot_min, absent, reason')
    .in('user_id', employees.map((e) => e.user_id))
    .gte('business_date', from)
    .lte('business_date', to);
  const cells: Record<string, { status: Status; late: number; ot: number }> = {};
  for (const o of ovs ?? []) cells[`${o.user_id}|${o.business_date}`] = cellFromOverride(o);

  return NextResponse.json({ data: { employees, cells } });
}

// POST /api/hr/timesheet/bulk-backfill — write the grid (owner ask 2026-07-08). Two shapes:
//   { store_id, cells: [{ user_id, business_date, status, late_min?, ot_min? }] } — per-cell grid
//   { store_id, date_from, date_to, status, late_min?, overwrite? }              — legacy fill
// 'clear' removes the override (reverts to derived). Store-manager/HR gated; audited as a summary.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const lateMinDefault = intOrNull(body.late_min) ?? DEFAULT_LATE_MIN;
  if (!storeId) return NextResponse.json({ error: 'store_id is required' }, { status: 400 });

  const auth = await requireStoreManager(storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const service = createServiceClient();

  const { data: usRows, error: usErr } = await service.from('user_stores').select('user_id').eq('store_id', storeId);
  if (usErr) return NextResponse.json({ error: 'Failed to load store members' }, { status: 500 });
  const memberSet = new Set((usRows ?? []).map((r) => r.user_id as string));

  // ---- Per-cell (grid editor) mode ----
  if (Array.isArray(body.cells)) {
    const raw = body.cells as { user_id?: unknown; business_date?: unknown; status?: unknown; late_min?: unknown; ot_min?: unknown }[];
    const cells = raw
      .filter((c) => typeof c.user_id === 'string' && memberSet.has(c.user_id) && typeof c.business_date === 'string' && isCalendarDate(c.business_date) && (CELL_STATUSES as readonly string[]).includes(c.status as string))
      .map((c) => ({ user_id: c.user_id as string, business_date: c.business_date as string, status: c.status as (typeof CELL_STATUSES)[number], late_min: intOrNull(c.late_min), ot_min: intOrNull(c.ot_min) }));
    if (cells.length > MAX_CELLS) return NextResponse.json({ error: `Too many cells (max ${MAX_CELLS}).` }, { status: 400 });
    if (cells.length === 0) return NextResponse.json({ data: { written: 0, cleared: 0 } });

    const userIds = [...new Set(cells.map((c) => c.user_id))];
    const { data: emps } = await service.from('hr_employees').select('profile_id, work_hours_per_day').in('profile_id', userIds);
    const whByUser = new Map((emps ?? []).map((e) => [e.profile_id as string, e.work_hours_per_day as number | null]));

    const upserts: Record<string, unknown>[] = [];
    const clears: { user_id: string; business_date: string }[] = [];
    for (const c of cells) {
      if (c.status === 'clear') { clears.push({ user_id: c.user_id, business_date: c.business_date }); continue; }
      const fullDayMin = Math.round((whByUser.get(c.user_id) ?? DEFAULT_WORK_HOURS) * 60);
      const lateMin = c.status === 'late' ? (c.late_min ?? lateMinDefault) : c.late_min;
      const f = fieldsForCell(c.status, fullDayMin, lateMin, c.ot_min);
      upserts.push({
        user_id: c.user_id, business_date: c.business_date, store_id: storeId,
        worked_min: f.worked_min, late_min: f.late_min, ot_min: f.ot_min, absent: f.absent,
        reason: `Bulk backfill: ${c.status}`, edited_by: auth.userId,
      });
    }

    if (upserts.length) {
      const { error } = await service.from(TABLE).upsert(upserts, { onConflict: 'user_id,business_date' });
      if (error) return NextResponse.json({ error: 'Failed to write timesheet' }, { status: 500 });
    }
    for (const c of clears) {
      await service.from(TABLE).delete().eq('user_id', c.user_id).eq('business_date', c.business_date);
    }

    await logHrAudit(service, {
      actorId: auth.userId, action: 'update', table: TABLE, recordId: storeId,
      before: null, after: { written: upserts.length, cleared: clears.length },
      reason: `Bulk backfill (grid): ${upserts.length} set, ${clears.length} cleared`,
    });
    return NextResponse.json({ data: { written: upserts.length, cleared: clears.length } });
  }

  // ---- Legacy whole-branch fill mode ----
  const dateFrom = typeof body.date_from === 'string' ? body.date_from : '';
  const dateTo = typeof body.date_to === 'string' ? body.date_to : '';
  const status = (STATUSES as string[]).includes(body.status as string) ? (body.status as Status) : null;
  const overwrite = body.overwrite === true;
  if (!isCalendarDate(dateFrom) || !isCalendarDate(dateTo) || dateFrom > dateTo) {
    return NextResponse.json({ error: 'valid date_from and date_to are required' }, { status: 400 });
  }
  if (!status) return NextResponse.json({ error: 'invalid status' }, { status: 400 });

  const memberIds = [...memberSet];
  if (memberIds.length === 0) return NextResponse.json({ data: { employees: 0, days: 0, written: 0, skipped: 0 } });

  const { data: emps, error: empErr } = await service
    .from('hr_employees').select('profile_id, work_hours_per_day').in('profile_id', memberIds).in('status', ['active', 'probation']);
  if (empErr) return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 });
  const employees = (emps ?? []) as { profile_id: string; work_hours_per_day: number | null }[];
  if (employees.length === 0) return NextResponse.json({ data: { employees: 0, days: 0, written: 0, skipped: 0 } });

  const dates = enumerateDates(dateFrom, dateTo);
  if (employees.length * dates.length > MAX_CELLS) {
    return NextResponse.json({ error: `Too many cells (${employees.length} × ${dates.length}). Narrow the range.` }, { status: 400 });
  }

  const existing = new Set<string>();
  if (!overwrite) {
    const { data: ex } = await service.from(TABLE).select('user_id, business_date')
      .in('user_id', employees.map((e) => e.profile_id)).gte('business_date', dateFrom).lte('business_date', dateTo);
    for (const r of ex ?? []) existing.add(`${r.user_id}|${r.business_date}`);
  }

  const reason = `Bulk backfill: ${status}`;
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const e of employees) {
    const fullDayMin = Math.round((e.work_hours_per_day ?? DEFAULT_WORK_HOURS) * 60);
    const f = fieldsForCell(status, fullDayMin, status === 'late' ? lateMinDefault : 0, null);
    for (const d of dates) {
      if (!overwrite && existing.has(`${e.profile_id}|${d}`)) { skipped++; continue; }
      rows.push({ user_id: e.profile_id, business_date: d, store_id: storeId, worked_min: f.worked_min, late_min: f.late_min, ot_min: f.ot_min, absent: f.absent, reason, edited_by: auth.userId });
    }
  }
  if (rows.length > 0) {
    const { error } = await service.from(TABLE).upsert(rows, { onConflict: 'user_id,business_date' });
    if (error) return NextResponse.json({ error: 'Failed to write timesheet' }, { status: 500 });
  }
  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: TABLE, recordId: storeId,
    before: null, after: { status, date_from: dateFrom, date_to: dateTo, written: rows.length, skipped, overwrite },
    reason: `Bulk backfill ${status}: ${rows.length} cells`,
  });
  return NextResponse.json({ data: { employees: employees.length, days: dates.length, written: rows.length, skipped } });
}
