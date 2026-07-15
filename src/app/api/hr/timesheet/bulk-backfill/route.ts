import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { enumerateDates } from '@/lib/hr/leaves';
import { fetchLeaveTypeOptions } from '@/lib/hr/leave-types';

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
    .select('profile_id, full_name, company_id, profile:profiles!hr_employees_profile_id_fkey(display_name, username)')
    .in('profile_id', memberIds)
    .in('status', ['active', 'probation']);
  if (empErr) return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 });
  const employees = (emps ?? [])
    .map((e) => ({
      user_id: e.profile_id as string,
      name: (e.full_name as string | null)?.trim() || nameOf(e.profile as never),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const companyId = (emps ?? []).find((e) => e.company_id)?.company_id ?? null;

  const empUserIds = employees.map((e) => e.user_id);
  const [ovsRes, leavesRes] = await Promise.all([
    service
      .from(TABLE)
      .select('user_id, business_date, worked_min, late_min, ot_min, absent, reason')
      .in('user_id', empUserIds)
      .gte('business_date', from)
      .lte('business_date', to),
    // Real approved leaves overlapping the range → each covered day seeds a typed 'leave' cell,
    // taking precedence over an override so the grid reflects the actual leave record.
    service
      .from('hr_leaves')
      .select('user_id, leave_type_id, from_date, to_date')
      .in('user_id', empUserIds)
      .eq('status', 'approved')
      .lte('from_date', to)
      .gte('to_date', from),
  ]);
  const cells: Record<string, { status: Status; late: number; ot: number; leave_type_id?: string }> = {};
  for (const o of ovsRes.data ?? []) cells[`${o.user_id}|${o.business_date}`] = cellFromOverride(o);
  for (const lv of leavesRes.data ?? []) {
    for (const d of enumerateDates(lv.from_date as string, lv.to_date as string)) {
      if (d < from || d > to) continue;
      cells[`${lv.user_id}|${d}`] = { status: 'leave', late: 0, ot: 0, leave_type_id: lv.leave_type_id as string };
    }
  }

  return NextResponse.json({ data: { employees, company_id: companyId, cells } });
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
    const raw = body.cells as { user_id?: unknown; business_date?: unknown; status?: unknown; late_min?: unknown; ot_min?: unknown; leave_type_id?: unknown }[];
    const cells = raw
      .filter((c) => typeof c.user_id === 'string' && memberSet.has(c.user_id) && typeof c.business_date === 'string' && isCalendarDate(c.business_date) && (CELL_STATUSES as readonly string[]).includes(c.status as string))
      .map((c) => ({ user_id: c.user_id as string, business_date: c.business_date as string, status: c.status as (typeof CELL_STATUSES)[number], late_min: intOrNull(c.late_min), ot_min: intOrNull(c.ot_min), leave_type_id: typeof c.leave_type_id === 'string' ? c.leave_type_id : null }));
    if (cells.length > MAX_CELLS) return NextResponse.json({ error: `Too many cells (max ${MAX_CELLS}).` }, { status: 400 });
    if (cells.length === 0) return NextResponse.json({ data: { written: 0, cleared: 0 } });

    const userIds = [...new Set(cells.map((c) => c.user_id))];
    const { data: emps } = await service.from('hr_employees').select('profile_id, work_hours_per_day, company_id').in('profile_id', userIds);
    const empByUser = new Map((emps ?? []).map((e) => [e.profile_id as string, { wh: e.work_hours_per_day as number | null, company_id: e.company_id as string | null }]));

    // Valid (active) leave types per involved company + global — a 'leave' cell must reference one.
    const companyIds = [...new Set((emps ?? []).map((e) => e.company_id as string | null).filter(Boolean))] as string[];
    const validTypeByCompany = new Map<string, Set<string>>();
    await Promise.all(
      companyIds.map(async (cid) => {
        const opts = await fetchLeaveTypeOptions(service, cid);
        validTypeByCompany.set(cid, new Set((opts ?? []).map((o) => o.id)));
      })
    );
    const isValidLeaveType = (companyId: string | null, typeId: string | null) =>
      !!companyId && !!typeId && (validTypeByCompany.get(companyId)?.has(typeId) ?? false);

    // Existing approved leaves overlapping the painted range. This tool only creates/edits
    // SINGLE-DAY leaves; a multi-day employee leave is never mutated — but we track its coverage so
    // re-saving a seeded leave cell never duplicates one.
    const paintedKeys = new Set(cells.map((c) => `${c.user_id}|${c.business_date}`));
    const allDates = cells.map((c) => c.business_date).sort();
    const minDate = allDates[0];
    const maxDate = allDates[allDates.length - 1];
    const { data: exLeaves } = await service
      .from('hr_leaves')
      .select('id, user_id, from_date, to_date, leave_type_id')
      .in('user_id', userIds)
      .eq('status', 'approved')
      .lte('from_date', maxDate)
      .gte('to_date', minDate);
    const singleDayLeaveByKey = new Map<string, { id: string; leave_type_id: string }>();
    const coverageTypeByKey = new Map<string, Set<string>>(); // key → leave_type_ids covering that day
    for (const l of exLeaves ?? []) {
      const single = l.from_date === l.to_date;
      for (const d of enumerateDates(l.from_date as string, l.to_date as string)) {
        const key = `${l.user_id}|${d}`;
        if (!paintedKeys.has(key)) continue;
        (coverageTypeByKey.get(key) ?? coverageTypeByKey.set(key, new Set()).get(key)!).add(l.leave_type_id as string);
        if (single) singleDayLeaveByKey.set(key, { id: l.id as string, leave_type_id: l.leave_type_id as string });
      }
    }

    const now = new Date().toISOString();
    const overrideUpserts: Record<string, unknown>[] = [];
    const overrideClears = new Set<string>(); // `${user_id}|${business_date}`
    const leaveIdsToDelete: string[] = [];
    const leavesToInsert: Record<string, unknown>[] = [];
    let written = 0;
    let cleared = 0;
    let skipped = 0;

    for (const c of cells) {
      const key = `${c.user_id}|${c.business_date}`;
      const existingLeave = singleDayLeaveByKey.get(key);
      const emp = empByUser.get(c.user_id);

      if (c.status === 'clear') {
        overrideClears.add(key);
        if (existingLeave) leaveIdsToDelete.push(existingLeave.id);
        cleared++;
        continue;
      }

      if (c.status === 'leave') {
        // Real typed leave (like the single-day edit modal), not a coarse override.
        if (!isValidLeaveType(emp?.company_id ?? null, c.leave_type_id)) { skipped++; continue; }
        overrideClears.add(key); // a leave day carries no override
        // Already covered by an approved leave of this exact type (single- or multi-day) → no-op.
        if (coverageTypeByKey.get(key)?.has(c.leave_type_id as string)) { written++; continue; }
        // A multi-day employee leave (different type) covers this day and there is no single-day
        // leave to replace → don't touch the multi-day record; skip to avoid an overlap/duplicate.
        if (!existingLeave && coverageTypeByKey.has(key)) { skipped++; continue; }
        if (existingLeave) leaveIdsToDelete.push(existingLeave.id); // replace the single-day type
        leavesToInsert.push({
          user_id: c.user_id, store_id: storeId, company_id: emp!.company_id,
          leave_type_id: c.leave_type_id, from_date: c.business_date, to_date: c.business_date,
          days: 1, reason: 'Bulk backfill', status: 'approved', approver_id: auth.userId, decided_at: now,
        });
        written++;
        continue;
      }

      // normal / absent / late / dayoff → override; drop any single-day leave it replaces.
      if (existingLeave) leaveIdsToDelete.push(existingLeave.id);
      const fullDayMin = Math.round((emp?.wh ?? DEFAULT_WORK_HOURS) * 60);
      const lateMin = c.status === 'late' ? (c.late_min ?? lateMinDefault) : c.late_min;
      const f = fieldsForCell(c.status, fullDayMin, lateMin, c.ot_min);
      overrideUpserts.push({
        user_id: c.user_id, business_date: c.business_date, store_id: storeId,
        worked_min: f.worked_min, late_min: f.late_min, ot_min: f.ot_min, absent: f.absent,
        reason: `Bulk backfill: ${c.status}`, edited_by: auth.userId,
      });
      written++;
    }

    // Order: remove replaced leaves, insert new leaves, upsert overrides, clear overrides.
    if (leaveIdsToDelete.length) {
      const { error } = await service.from('hr_leaves').delete().in('id', leaveIdsToDelete);
      if (error) return NextResponse.json({ error: 'Failed to update leaves' }, { status: 500 });
    }
    if (leavesToInsert.length) {
      const { error } = await service.from('hr_leaves').insert(leavesToInsert);
      if (error) return NextResponse.json({ error: 'Failed to create leaves' }, { status: 500 });
    }
    if (overrideUpserts.length) {
      const { error } = await service.from(TABLE).upsert(overrideUpserts, { onConflict: 'user_id,business_date' });
      if (error) return NextResponse.json({ error: 'Failed to write timesheet' }, { status: 500 });
    }
    for (const key of overrideClears) {
      const [uid, date] = key.split('|');
      await service.from(TABLE).delete().eq('user_id', uid).eq('business_date', date);
    }

    await logHrAudit(service, {
      actorId: auth.userId, action: 'update', table: TABLE, recordId: storeId,
      before: null, after: { written, cleared, skipped, leaves_created: leavesToInsert.length, leaves_removed: leaveIdsToDelete.length },
      reason: `Bulk backfill (grid): ${written} set, ${cleared} cleared, ${leavesToInsert.length} leaves`,
    });
    return NextResponse.json({ data: { written, cleared, skipped } });
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
