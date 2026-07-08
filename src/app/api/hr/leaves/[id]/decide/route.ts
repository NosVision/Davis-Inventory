import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyUser } from '@/lib/notifications/service';
import { enumerateDates, classifyLeaveEffect } from '@/lib/hr/leaves';

// Tell the employee their leave was approved/rejected (best-effort — never fail the decision).
async function notifyLeaveDecision(
  row: { user_id: string; store_id: string | null; from_date: string; to_date: string },
  decision: 'approved' | 'rejected',
  note: string | null
): Promise<void> {
  try {
    const range = row.from_date === row.to_date ? row.from_date : `${row.from_date} – ${row.to_date}`;
    const ok = decision === 'approved';
    await notifyUser({
      userId: row.user_id,
      storeId: row.store_id,
      type: 'hr_leave_result',
      title: ok ? 'คำขอลาได้รับอนุมัติ' : 'คำขอลาถูกปฏิเสธ',
      body: `${ok ? 'อนุมัติ' : 'ไม่อนุมัติ'}การลา ${range}${note ? ` — ${note}` : ''}`,
      data: { url: '/me/leaves' },
    });
  } catch (e) {
    console.error('[leaves/decide] notify employee failed:', e);
  }
}

const TABLE = 'hr_leaves';
const OVERRIDE_TABLE = 'hr_timesheet_overrides';
const OVERRIDE_COLS =
  'id, user_id, business_date, store_id, worked_min, late_min, ot_min, absent, note, reason, edited_by';

const DEFAULT_WORK_HOURS = 9; // §A default when hr_employees.work_hours_per_day is null

interface ScheduleCell {
  store_id: string | null;
  is_day_off: boolean;
  shift_template_id: string | null;
}

// POST /api/hr/leaves/[id]/decide — a manager/HR approves or rejects a pending leave
// (§E/§H). Every status transition is an atomic compare-and-set (`.eq('status','pending')`,
// 0 rows → 409) so a decide racing a concurrent cancel/decide can never clobber an
// already-decided row. Approval APPLIES the §H leave effect to each scheduled work day's
// hr_timesheet_overrides row; because the status flip is committed FIRST, an apply
// failure never rolls back (or hides) the approval — it just returns a 200 + warning.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(TABLE)
    .select('id, store_id, status, user_id, company_id, leave_type_id, from_date, to_date, days, reason, cert_path')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load leave request' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });

  const auth = row.store_id
    ? await requireStoreManager(row.store_id as string)
    : await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if ((row.status as string) !== 'pending') {
    return NextResponse.json({ error: 'Only pending leave requests can be decided' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }

  const decidedAt = new Date().toISOString();

  // --- REJECT: a single atomic flip, no timesheet effect. ---
  if (decision === 'rejected') {
    const { data: updated, error } = await service
      .from(TABLE)
      .update({
        status: 'rejected',
        approver_id: auth.userId,
        decided_at: decidedAt,
        decision_note: note,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) return NextResponse.json({ error: 'Failed to reject leave request' }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Already decided' }, { status: 409 });
    }

    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: TABLE,
      recordId: id,
      before: { status: 'pending' },
      after: { status: 'rejected', decision_note: note },
      reason: note ?? undefined,
    });

    await notifyLeaveDecision(
      { user_id: row.user_id as string, store_id: row.store_id as string | null, from_date: row.from_date as string, to_date: row.to_date as string },
      'rejected',
      note
    );

    return NextResponse.json({ data: { id, status: 'rejected' } });
  }

  // --- APPROVE: FIRST the atomic flip (source of truth), THEN best-effort apply. ---
  const { data: updated, error } = await service
    .from(TABLE)
    .update({
      status: 'approved',
      approver_id: auth.userId,
      decided_at: decidedAt,
      decision_note: note,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to approve leave request' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Already decided' }, { status: 409 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    before: { status: 'pending' },
    after: { status: 'approved', decision_note: note },
    reason: note ?? undefined,
  });

  await notifyLeaveDecision(
    { user_id: row.user_id as string, store_id: row.store_id as string | null, from_date: row.from_date as string, to_date: row.to_date as string },
    'approved',
    note
  );

  // --- Apply the §H leave effect. Everything below is best-effort: on failure we
  // collect a warning and still return 200, since the approval already committed. ---
  const warnings: string[] = [];
  let appliedDays = 0;

  const { data: leaveType, error: ltErr } = await service
    .from('hr_leave_types')
    .select('code, paid')
    .eq('id', row.leave_type_id as string)
    .maybeSingle();
  if (ltErr || !leaveType) {
    return NextResponse.json({
      data: { id, status: 'approved', applied_days: 0 },
      warning:
        'Leave approved, but the leave type could not be loaded to apply timesheet effects. Manual follow-up required.',
    });
  }

  const code = leaveType.code as string;
  const hasCert = Boolean(row.cert_path);
  const effect = classifyLeaveEffect({ code, paid: leaveType.paid as boolean }, hasCert);

  // Company holidays (skipped — not scheduled work days for pay purposes).
  const { data: holidays } = await service
    .from('hr_holidays')
    .select('holiday_date')
    .eq('company_id', row.company_id as string)
    .eq('active', true);
  const holidaySet = new Set((holidays ?? []).map((h) => h.holiday_date as string));

  // Employee full-day minutes for a paid-leave credit.
  const { data: emp } = await service
    .from('hr_employees')
    .select('work_hours_per_day')
    .eq('profile_id', row.user_id as string)
    .maybeSingle();
  const workHours = (emp?.work_hours_per_day as number | null) ?? DEFAULT_WORK_HOURS;
  const fullDayMin = workHours * 60;

  for (const d of enumerateDates(row.from_date as string, row.to_date as string)) {
    if (holidaySet.has(d)) continue;

    // Only apply to actual scheduled work days: a row that exists, is not a day-off,
    // and has a shift assigned. A leave filed for a future date with no schedule row,
    // or over a day-off, has no timesheet effect.
    const { data: cell, error: cellErr } = await service
      .from('hr_schedule')
      .select('store_id, is_day_off, shift_template_id')
      .eq('user_id', row.user_id as string)
      .eq('work_date', d)
      .maybeSingle<ScheduleCell>();
    if (cellErr) {
      warnings.push(`Could not read schedule for ${d}`);
      continue;
    }
    if (!cell || cell.is_day_off === true || cell.shift_template_id == null) continue;

    const overrideStoreId = cell.store_id;

    const { data: existing, error: existingErr } = await service
      .from(OVERRIDE_TABLE)
      .select(OVERRIDE_COLS)
      .eq('user_id', row.user_id as string)
      .eq('business_date', d)
      .maybeSingle();
    if (existingErr) {
      warnings.push(`Could not read existing timesheet for ${d}`);
      continue;
    }

    const overrideRow = effect.deductSalary
      ? {
          user_id: row.user_id as string,
          business_date: d,
          worked_min: 0,
          late_min: 0,
          ot_min: existing?.ot_min ?? null,
          absent: true,
          note: existing?.note ?? null,
          reason: `Leave approved (unpaid): ${code}`,
          store_id: overrideStoreId,
          edited_by: auth.userId,
        }
      : {
          user_id: row.user_id as string,
          business_date: d,
          worked_min: fullDayMin,
          late_min: 0,
          ot_min: existing?.ot_min ?? null,
          absent: false,
          note: existing?.note ?? null,
          reason: `Leave approved (paid): ${code}`,
          store_id: overrideStoreId,
          edited_by: auth.userId,
        };

    const { data: after, error: applyErr } = await service
      .from(OVERRIDE_TABLE)
      .upsert(overrideRow, { onConflict: 'user_id,business_date' })
      .select(OVERRIDE_COLS)
      .single();
    if (applyErr) {
      warnings.push(`Failed to apply timesheet override for ${d}`);
      continue;
    }

    appliedDays++;
    await logHrAudit(service, {
      actorId: auth.userId,
      action: existing ? 'update' : 'create',
      table: OVERRIDE_TABLE,
      recordId: after.id as string,
      before: existing ?? null,
      after,
      reason: overrideRow.reason,
    });
  }

  return NextResponse.json({
    data: { id, status: 'approved', applied_days: appliedDays },
    ...(warnings.length ? { warning: warnings.join('; ') } : {}),
  });
}
