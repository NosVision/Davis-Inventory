import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyUser } from '@/lib/notifications/service';

const TABLE = 'hr_attendance';
const TYPE_TH: Record<string, string> = {
  in: 'เข้างาน',
  out: 'ออกงาน',
  break_start: 'เริ่มพัก',
  break_end: 'เลิกพัก',
};

// POST /api/hr/attendance/[id]/review { decision: 'approved'|'rejected', note? } — a manager/HR
// clears an out-of-geofence / suspect punch (§F enforcement, owner 2026-07-08). Atomic
// compare-and-set on review_status='pending' so a decision can't clobber a concurrent one.
// The employee is notified of the outcome (best-effort). The punch row itself is kept either way
// (payroll source of truth); 'rejected' simply marks it as not-counted for HR's downstream review.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(TABLE)
    .select('id, user_id, store_id, type, ts, review_status')
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
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;
  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }

  const { data: updated, error } = await service
    .from(TABLE)
    .update({
      review_status: decision,
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
      review_note: note,
    })
    .eq('id', id)
    .eq('review_status', 'pending')
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to save review' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Already decided' }, { status: 409 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    before: { review_status: 'pending' },
    after: { review_status: decision, review_note: note },
    reason: note ?? `Attendance ${decision}`,
  });

  // Tell the employee the outcome (best-effort).
  try {
    const label = TYPE_TH[row.type as string] ?? (row.type as string);
    const ok = decision === 'approved';
    await notifyUser({
      userId: row.user_id as string,
      storeId: row.store_id as string | null,
      type: 'hr_attendance_result',
      title: ok ? 'การลงเวลาได้รับอนุมัติ' : 'การลงเวลาถูกปฏิเสธ',
      body: `${ok ? 'อนุมัติ' : 'ไม่อนุมัติ'}การ${label} (นอกพื้นที่)${note ? ` — ${note}` : ''}`,
      data: { url: '/me/checkin' },
    });
  } catch (e) {
    console.error('[attendance/review] notify employee failed:', e);
  }

  return NextResponse.json({ data: { id, review_status: decision } });
}
