import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyUser } from '@/lib/notifications/service';
import { isDateInFinalizedPeriod, employeeStoreIds, FINALIZED_PERIOD_ERROR } from '@/lib/hr/period-lock';
import { fetchLeaveTypeOptions } from '@/lib/hr/leave-types';

const TABLE = 'hr_attendance';
const OVERRIDE_TABLE = 'hr_timesheet_overrides';
const TYPE_TH: Record<string, string> = {
  in: 'เข้างาน',
  out: 'ออกงาน',
  break_start: 'เริ่มพัก',
  break_end: 'เลิกพัก',
};

// The resolutions HR can pick for an out-of-geofence / suspect punch.
type Action = 'approve' | 'reject' | 'set_time' | 'absent' | 'leave';
const ACTIONS: Action[] = ['approve', 'reject', 'set_time', 'absent', 'leave'];

// POST /api/hr/attendance/[id]/review — a manager/HR resolves a pending out-of-geofence / suspect
// punch (§F enforcement, owner 2026-07-08). Beyond approve/reject it can set the real time, or mark
// the day absent / on leave — all of which flow through to the derived timesheet, so pay recomputes:
//   approve   → keep the punch (counts as-is)
//   reject    → dismiss the punch (excluded from the timesheet derivation → not counted)
//   set_time  → correct the punch's timestamp, then approve
//   absent    → dismiss the punch + write a timesheet override (worked 0, absent)
//   leave     → dismiss the punch + write a paid full-day timesheet override
// Atomic compare-and-set on review_status='pending'. The employee is notified of the outcome.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(TABLE)
    .select('id, user_id, store_id, type, ts, business_date, review_status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load punch' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Punch not found' }, { status: 404 });

  const auth = row.store_id
    ? await requireStoreManager(row.store_id as string)
    : await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if ((row.review_status as string | null) !== 'pending') {
    return NextResponse.json({ error: 'Only punches pending review can be decided' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // Back-compat: the old client sent { decision: 'approved' | 'rejected' }.
  const rawAction = typeof body.action === 'string'
    ? body.action
    : body.decision === 'approved' ? 'approve'
      : body.decision === 'rejected' ? 'reject' : '';
  const action = ACTIONS.includes(rawAction as Action) ? (rawAction as Action) : null;
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;
  const leaveTypeId = typeof body.leave_type_id === 'string' ? body.leave_type_id : null;
  if (!action) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  if (action === 'leave' && !leaveTypeId) {
    return NextResponse.json({ error: 'leave_type_id is required for a leave outcome' }, { status: 400 });
  }

  const userId = row.user_id as string;
  const businessDate = row.business_date as string;
  const label = TYPE_TH[row.type as string] ?? (row.type as string);

  // §Phase 0B: every resolution (approve/reject/set_time/absent/leave) changes this day's derived
  // timesheet, a payroll input. Refuse once the day's pay period is finalized — reopen first.
  try {
    const storeIds = await employeeStoreIds(service, userId, row.store_id as string | null);
    if (await isDateInFinalizedPeriod(service, businessDate, storeIds)) {
      return NextResponse.json({ error: FINALIZED_PERIOD_ERROR }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ error: 'Failed to verify pay period' }, { status: 500 });
  }

  // ---- Validate + prepare the punch mutation (set_time) ----
  let newTs: string | null = null;
  if (action === 'set_time') {
    const ts = typeof body.ts === 'string' ? body.ts : '';
    const parsed = ts ? new Date(ts) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'A valid ts is required for set_time' }, { status: 400 });
    }
    newTs = parsed.toISOString();
  }

  // approve / set_time keep the punch (approved); reject / absent / leave dismiss it (rejected).
  const newStatus = action === 'approve' || action === 'set_time' ? 'approved' : 'rejected';

  const patch: Record<string, unknown> = {
    review_status: newStatus,
    reviewed_by: auth.userId,
    reviewed_at: new Date().toISOString(),
    review_note: note,
  };
  if (newTs) patch.ts = newTs;

  const { data: updated, error } = await service
    .from(TABLE)
    .update(patch)
    .eq('id', id)
    .eq('review_status', 'pending')
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to save review' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Already decided' }, { status: 409 });
  }

  // ---- absent → timesheet override; leave → a real typed hr_leaves record (recomputes pay) ----
  let overrideWarning: string | null = null;
  if (action === 'absent') {
    const { error: ovErr } = await service.from(OVERRIDE_TABLE).upsert(
      {
        user_id: userId,
        business_date: businessDate,
        store_id: row.store_id,
        worked_min: 0,
        late_min: 0,
        ot_min: null,
        absent: true,
        reason: 'Attendance review: absent',
        edited_by: auth.userId,
      },
      { onConflict: 'user_id,business_date' }
    );
    if (ovErr) {
      console.error('[attendance/review] override write failed:', ovErr.message);
      overrideWarning = 'Marked, but writing the timesheet override failed — set it manually.';
    }
  } else if (action === 'leave') {
    // Create a real single-day approved leave of the chosen type (flows through the leave pay
    // engine), replacing any coarse override or existing single-day leave on that day.
    const { data: emp } = await service
      .from('hr_employees')
      .select('company_id')
      .eq('profile_id', userId)
      .maybeSingle();
    const companyId = (emp?.company_id as string | null) ?? null;
    const options = await fetchLeaveTypeOptions(service, companyId);
    const valid = (options ?? []).some((o) => o.id === leaveTypeId);
    if (!companyId || !valid) {
      overrideWarning = 'Punch dismissed, but the leave type is not valid for this employee — file the leave manually.';
    } else {
      await service.from(OVERRIDE_TABLE).delete().eq('user_id', userId).eq('business_date', businessDate);
      // Drop any existing single-day leave on the day, then insert the chosen one.
      const { data: existing } = await service
        .from('hr_leaves')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'approved')
        .eq('from_date', businessDate)
        .eq('to_date', businessDate);
      if (existing?.length) await service.from('hr_leaves').delete().in('id', existing.map((r) => r.id as string));
      const { error: lvErr } = await service.from('hr_leaves').insert({
        user_id: userId,
        store_id: row.store_id,
        company_id: companyId,
        leave_type_id: leaveTypeId,
        from_date: businessDate,
        to_date: businessDate,
        days: 1,
        reason: note ?? 'Attendance review',
        status: 'approved',
        approver_id: auth.userId,
        decided_at: new Date().toISOString(),
      });
      if (lvErr) {
        console.error('[attendance/review] leave create failed:', lvErr.message);
        overrideWarning = 'Punch dismissed, but creating the leave failed — file it manually.';
      }
    }
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    before: { review_status: 'pending' },
    after: { review_status: newStatus, action, ...(newTs ? { ts: newTs } : {}) },
    reason: note ?? `Attendance ${action}`,
  });

  // ---- Notify the employee of the outcome (best-effort) ----
  try {
    const OUTCOME_TH: Record<Action, { title: string; body: string }> = {
      approve: { title: 'การลงเวลาได้รับอนุมัติ', body: `อนุมัติการ${label} (นอกพื้นที่)` },
      reject: { title: 'การลงเวลาถูกปฏิเสธ', body: `ไม่นับการ${label} (นอกพื้นที่)` },
      set_time: { title: 'แก้ไขเวลาลงเวลา', body: `ปรับเวลา${label}ให้ตามจริงแล้ว` },
      absent: { title: 'บันทึกเป็นขาดงาน', body: `วันนี้ถูกบันทึกเป็นขาดงาน` },
      leave: { title: 'บันทึกเป็นวันลา', body: `วันนี้ถูกบันทึกเป็นวันลา` },
    };
    const o = OUTCOME_TH[action];
    await notifyUser({
      userId,
      storeId: row.store_id as string | null,
      type: 'hr_attendance_result',
      title: o.title,
      body: `${o.body}${note ? ` — ${note}` : ''}`,
      data: { url: '/me/checkin' },
    });
  } catch (e) {
    console.error('[attendance/review] notify employee failed:', e);
  }

  return NextResponse.json({ data: { id, review_status: newStatus, action }, ...(overrideWarning ? { warning: overrideWarning } : {}) });
}
