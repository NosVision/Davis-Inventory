import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logHrAudit } from '@/lib/hr/audit';
import { BUCKET, decodeSignaturePng } from '@/lib/hr/warnings';

const TABLE = 'hr_offboarding';

const COLS =
  'id, user_id, company_id, store_id, kind, reason, notice_date, last_working_date, ' +
  'severance_note, status, employee_signature_path, employee_signed_at, hr_signature_path, ' +
  'hr_signed_at, hr_signed_by, initiated_by, completed_at, created_at, updated_at, updated_by';

// POST /api/hr/ess/offboarding/[id]/ack — the EMPLOYEE acknowledges (signs) their OWN
// offboarding. Body: { signature: "data:image/png;base64,..." }. Auth-any, but the
// record must belong to the caller. A completed or cancelled offboarding can no longer
// be acknowledged (409).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(TABLE)
    .select('id, status, user_id')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load offboarding' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Offboarding not found' }, { status: 404 });
  if ((row.user_id as string) !== user.id) {
    return NextResponse.json({ error: 'Forbidden — not your offboarding' }, { status: 403 });
  }
  const status = row.status as string;
  if (status === 'completed' || status === 'cancelled') {
    return NextResponse.json({ error: 'This offboarding can no longer be acknowledged' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decoded = decodeSignaturePng(body.signature);
  if (!decoded.ok) return NextResponse.json({ error: decoded.error }, { status: 400 });

  const path = `offboarding/${id}/employee-${user.id}.png`;
  const { error: uploadErr } = await service.storage.from(BUCKET).upload(path, decoded.buffer, {
    contentType: 'image/png',
    cacheControl: '3600',
    upsert: true,
  });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { data, error: updErr } = await service
    .from(TABLE)
    .update({
      employee_signature_path: path,
      employee_signed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(COLS)
    .single();
  if (updErr) {
    await service.storage.from(BUCKET).remove([path]).catch(() => {});
    return NextResponse.json({ error: 'Failed to record acknowledgement' }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: user.id,
    action: 'update',
    table: TABLE,
    recordId: id,
    after: { employee_signature_path: path },
    reason: 'Offboarding acknowledged by employee',
  });

  return NextResponse.json({ data });
}
