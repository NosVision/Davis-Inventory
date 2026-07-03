import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { BUCKET, decodeSignaturePng } from '@/lib/hr/warnings';

const TABLE = 'hr_offboarding';

const COLS =
  'id, user_id, company_id, store_id, kind, reason, notice_date, last_working_date, ' +
  'severance_note, status, employee_signature_path, employee_signed_at, hr_signature_path, ' +
  'hr_signed_at, hr_signed_by, initiated_by, completed_at, created_at, updated_at, updated_by';

// POST /api/hr/offboarding/[id]/sign — HR signs off on the offboarding. Body:
// { signature: "data:image/png;base64,..." }. The PNG is stored in the private
// bucket and the hr_signature_path / hr_signed_at / hr_signed_by fields recorded.
// A completed or cancelled offboarding can no longer be signed (409).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(TABLE)
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load offboarding' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Offboarding not found' }, { status: 404 });
  const status = row.status as string;
  if (status === 'completed' || status === 'cancelled') {
    return NextResponse.json({ error: 'This offboarding can no longer be signed' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decoded = decodeSignaturePng(body.signature);
  if (!decoded.ok) return NextResponse.json({ error: decoded.error }, { status: 400 });

  const path = `offboarding/${id}/hr-${auth.userId}.png`;
  const { error: uploadErr } = await service.storage.from(BUCKET).upload(path, decoded.buffer, {
    contentType: 'image/png',
    cacheControl: '3600',
    upsert: true,
  });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { data, error: updErr } = await service
    .from(TABLE)
    .update({
      hr_signature_path: path,
      hr_signed_at: new Date().toISOString(),
      hr_signed_by: auth.userId,
      updated_by: auth.userId,
    })
    .eq('id', id)
    .select(COLS)
    .single();
  if (updErr) {
    await service.storage.from(BUCKET).remove([path]).catch(() => {});
    return NextResponse.json({ error: 'Failed to record HR sign-off' }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    after: { hr_signature_path: path, hr_signed_by: auth.userId },
    reason: 'Offboarding signed off by HR',
  });

  return NextResponse.json({ data });
}
