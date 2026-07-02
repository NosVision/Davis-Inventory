import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { isUniqueViolation } from '@/lib/hr/db-errors';

const BUCKET = 'hr-documents';
const PNG_PREFIX = 'data:image/png;base64,';

// POST /api/hr/ess/policies/[id]/ack — employee self-service acknowledgement.
// Body: { signature: "data:image/png;base64,..." }. Uploads the signature to the
// private hr-documents bucket and records the ack row (which is itself the audit
// record). Any authenticated user may ack; the ack row's UNIQUE constraint keeps
// a repeat submit for the same version idempotent.
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
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!signature.startsWith(PNG_PREFIX)) {
    return NextResponse.json(
      { error: 'signature must be a data:image/png;base64 data URL' },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // Policy must exist and be active to be acknowledged.
  const { data: policy, error: policyErr } = await service
    .from('hr_policies')
    .select('id, version, active')
    .eq('id', id)
    .single();
  if (policyErr || !policy || !policy.active) {
    return NextResponse.json({ error: 'Policy not found or inactive' }, { status: 400 });
  }

  const b64 = signature.slice(PNG_PREFIX.length);
  // Cap the encoded payload before decoding so a hostile client cannot force a
  // large base64 decode (~3MB of base64 ≈ ~2.25MB of PNG, ample for a signature).
  const MAX_SIG_B64 = 3 * 1024 * 1024;
  if (b64.length > MAX_SIG_B64) {
    return NextResponse.json({ error: 'Signature too large' }, { status: 400 });
  }
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0) {
    return NextResponse.json({ error: 'signature is empty' }, { status: 400 });
  }
  // Verify the PNG magic bytes (\x89 P N G) so only real PNGs reach storage.
  if (
    !(buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
  ) {
    return NextResponse.json({ error: 'signature must be a valid PNG' }, { status: 400 });
  }

  const path = `signatures/policy/${id}/${user.id}-${Date.now()}.png`;
  const { error: uploadErr } = await service.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'image/png',
    cacheControl: '3600',
    upsert: false,
  });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { error: insertErr } = await service.from('hr_policy_acknowledgements').insert({
    policy_id: id,
    user_id: user.id,
    policy_version: policy.version,
    signature_path: path,
  });
  if (insertErr) {
    // The PNG was uploaded before this insert, so any insert failure leaves an
    // orphaned object — remove it before returning either outcome.
    await service.storage.from(BUCKET).remove([path]).catch(() => {});
    // Already acknowledged this version — treat as success, not an error.
    if (isUniqueViolation(insertErr)) {
      return NextResponse.json({ already: true }, { status: 200 });
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
