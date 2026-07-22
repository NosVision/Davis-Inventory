import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForRowStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyUser } from '@/lib/notifications/service';

const TABLE = 'hr_resignation_requests';

// POST /api/hr/resignation-requests/[id]/reject — HR declines the notice (e.g. the
// resignation was retracted after a talk, or the request was a mistake). Body:
// { note? }. Atomic compare-and-set (pending → rejected); anything else → 409.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireHrManagerForRowStore(TABLE, id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const note = typeof body.note === 'string' ? body.note.trim() || null : null;

  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(TABLE)
    .select('id, user_id, store_id, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load request' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

  const { data: updated, error } = await service
    .from(TABLE)
    .update({
      status: 'rejected',
      review_note: note,
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to reject request' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'This request has already been handled' }, { status: 409 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    before: { status: 'pending' },
    after: { status: 'rejected', review_note: note },
    reason: 'Resignation request rejected',
  });

  // Tell the employee (best-effort).
  try {
    await notifyUser({
      userId: row.user_id as string,
      storeId: (row.store_id as string | null) ?? null,
      type: 'hr_resignation_result',
      title: 'ใบลาออกไม่ได้รับการรับเรื่อง',
      body: note
        ? `ฝ่ายบุคคลปฏิเสธใบลาออกของคุณ — ${note}`
        : 'ฝ่ายบุคคลปฏิเสธใบลาออกของคุณ — ติดต่อฝ่ายบุคคลหากมีข้อสงสัย',
      data: { url: '/me/offboarding' },
    });
  } catch {
    /* best-effort */
  }

  return NextResponse.json({ data: { id, status: 'rejected' } });
}
