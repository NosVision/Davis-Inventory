import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isUniqueViolation } from '@/lib/hr/db-errors';
import { BUCKET, decodeSignaturePng, maybeFinalize } from '@/lib/hr/warnings';

const TABLE = 'hr_warnings';
const SIG_TABLE = 'hr_warning_signatures';

// POST /api/hr/warnings/[id]/sign — a MANAGER or HR adds their signature to a warning.
// Body: { signature: "data:image/png;base64,...", role: 'manager'|'hr' }. The employee
// signs via the ESS ack route, not here. Once all three roles have signed, the warning
// flips active → acknowledged.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: warning, error: loadErr } = await service
    .from(TABLE)
    .select('id, store_id, status, user_id')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load warning' }, { status: 500 });
  if (!warning) return NextResponse.json({ error: 'Warning not found' }, { status: 404 });
  if ((warning.status as string) === 'void') {
    return NextResponse.json({ error: 'Warning has been voided' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const role = typeof body.role === 'string' ? body.role : '';
  if (role !== 'manager' && role !== 'hr') {
    return NextResponse.json(
      { error: "role must be 'manager' or 'hr' (employees use the ESS ack route)" },
      { status: 400 }
    );
  }

  // Authorize by the requested role: manager → scoped to this warning's store, hr →
  // company-wide HR.
  const auth =
    role === 'manager'
      ? await requireStoreManager(warning.store_id as string)
      : await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const decoded = decodeSignaturePng(body.signature);
  if (!decoded.ok) return NextResponse.json({ error: decoded.error }, { status: 400 });

  // Reject a duplicate for this role BEFORE uploading: the storage path is
  // deterministic, so a re-sign would otherwise collide at storage (→500) rather than
  // surfacing a clean 409, and unique-violation cleanup could delete the first
  // signer's file. The DB UNIQUE(warning_id, role) stays as the race backstop below.
  const { data: existingSig, error: existErr } = await service
    .from(SIG_TABLE)
    .select('id')
    .eq('warning_id', id)
    .eq('role', role)
    .maybeSingle();
  if (existErr) return NextResponse.json({ error: 'Failed to check signature' }, { status: 500 });
  if (existingSig) {
    return NextResponse.json({ error: 'already signed for this role' }, { status: 409 });
  }

  const path = `warnings/signatures/${id}/${role}-${auth.userId}.png`;
  const { error: uploadErr } = await service.storage.from(BUCKET).upload(path, decoded.buffer, {
    contentType: 'image/png',
    cacheControl: '3600',
    upsert: false,
  });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { error: insertErr } = await service.from(SIG_TABLE).insert({
    warning_id: id,
    role,
    signed_by: auth.userId,
    signature_path: path,
  });
  if (insertErr) {
    // The PNG was uploaded before this insert — remove the orphan on any failure.
    await service.storage.from(BUCKET).remove([path]).catch(() => {});
    if (isUniqueViolation(insertErr)) {
      return NextResponse.json({ error: 'already signed for this role' }, { status: 409 });
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: SIG_TABLE,
    recordId: id,
    after: { warning_id: id, role, signed_by: auth.userId },
    reason: `Warning signed: ${role}`,
  });

  // Flip to acknowledged once all three parties have signed.
  const finalize = await maybeFinalize(service, id);
  if (finalize.flipped) {
    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: TABLE,
      recordId: id,
      before: { status: 'active' },
      after: { status: 'acknowledged' },
      reason: 'All three parties signed',
    });
  }

  return NextResponse.json({ data: { role, acknowledged: finalize.acknowledged } });
}
