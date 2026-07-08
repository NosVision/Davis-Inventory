import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyUser } from '@/lib/notifications/service';

const TABLE = 'hr_attendance';
const OVERRIDE_TABLE = 'hr_timesheet_overrides';
const DEFAULT_WORK_HOURS = 9;
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
  if (!action) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  const userId = row.user_id as string;
  const businessDate = row.business_date as string;
  const label = TYPE_TH[row.type as string] ?? (row.type as string);

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

  // ---- absent / leave: write a timesheet override for the day (recomputes pay) ----
  let overrideWarning: string | null = null;
  if (action === 'absent' || action === 'leave') {
    let workedMin = 0;
    if (action === 'leave') {
      const { data: emp } = await service
        .from('hr_employees')
        .select('work_hours_per_day')
        .eq('profile_id', userId)
        .maybeSingle();
      workedMin = Math.round(((emp?.work_hours_per_day as number | null) ?? DEFAULT_WORK_HOURS) * 60);
    }
    const { error: ovErr } = await service.from(OVERRIDE_TABLE).upsert(
      {
        user_id: userId,
        business_date: businessDate,
        store_id: row.store_id,
        worked_min: workedMin,
        late_min: 0,
        ot_min: null,
        absent: action === 'absent',
        reason: `Attendance review: ${action}`,
        edited_by: auth.userId,
      },
      { onConflict: 'user_id,business_date' }
    );
    if (ovErr) {
      console.error('[attendance/review] override write failed:', ovErr.message);
      overrideWarning = 'Marked, but writing the timesheet override failed — set it manually.';
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
