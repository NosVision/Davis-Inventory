import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logHrAudit } from '@/lib/hr/audit';
import { isUniqueViolation } from '@/lib/hr/db-errors';
import { BUCKET, decodeSignaturePng, maybeFinalize } from '@/lib/hr/warnings';

const TABLE = 'hr_warnings';
const SIG_TABLE = 'hr_warning_signatures';

// POST /api/hr/ess/warnings/[id]/ack — the EMPLOYEE acknowledges (signs) their OWN
// warning (role='employee'). Body: { signature: "data:image/png;base64,..." }. Auth-any,
// but the warning must belong to the caller. Once all three parties have signed, the
// warning flips active → acknowledged.
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

  const { data: warning, error: loadErr } = await service
    .from(TABLE)
    .select('id, status, user_id')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load warning' }, { status: 500 });
  if (!warning) return NextResponse.json({ error: 'Warning not found' }, { status: 404 });
  if ((warning.user_id as string) !== user.id) {
    return NextResponse.json({ error: 'Forbidden — not your warning' }, { status: 403 });
  }
  if ((warning.status as string) === 'void') {
    return NextResponse.json({ error: 'Warning has been voided' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decoded = decodeSignaturePng(body.signature);
  if (!decoded.ok) return NextResponse.json({ error: decoded.error }, { status: 400 });

  // Reject a repeat acknowledgement BEFORE uploading (deterministic path would
  // otherwise collide at storage → 500). DB UNIQUE(warning_id, role) is the backstop.
  const { data: existingSig, error: existErr } = await service
    .from(SIG_TABLE)
    .select('id')
    .eq('warning_id', id)
    .eq('role', 'employee')
    .maybeSingle();
  if (existErr) return NextResponse.json({ error: 'Failed to check acknowledgement' }, { status: 500 });
  if (existingSig) {
    return NextResponse.json({ error: 'already acknowledged' }, { status: 409 });
  }

  const path = `warnings/signatures/${id}/employee-${user.id}.png`;
  const { error: uploadErr } = await service.storage.from(BUCKET).upload(path, decoded.buffer, {
    contentType: 'image/png',
    cacheControl: '3600',
    upsert: false,
  });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { error: insertErr } = await service.from(SIG_TABLE).insert({
    warning_id: id,
    role: 'employee',
    signed_by: user.id,
    signature_path: path,
  });
  if (insertErr) {
    // The PNG was uploaded before this insert — remove the orphan on any failure.
    await service.storage.from(BUCKET).remove([path]).catch(() => {});
    if (isUniqueViolation(insertErr)) {
      return NextResponse.json({ error: 'already acknowledged' }, { status: 409 });
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: user.id,
    action: 'create',
    table: SIG_TABLE,
    recordId: id,
    after: { warning_id: id, role: 'employee', signed_by: user.id },
    reason: 'Warning acknowledged by employee',
  });

  // Flip to acknowledged once all three parties have signed.
  const finalize = await maybeFinalize(service, id);
  if (finalize.flipped) {
    await logHrAudit(service, {
      actorId: user.id,
      action: 'update',
      table: TABLE,
      recordId: id,
      before: { status: 'active' },
      after: { status: 'acknowledged' },
      reason: 'All three parties signed',
    });
  }

  return NextResponse.json({ data: { acknowledged: finalize.acknowledged } });
}
