import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, requireStoreManager } from '@/lib/hr/route-auth';

const BUCKET = 'hr-documents';
const SIGNED_URL_TTL_SECONDS = 300;

// GET /api/hr/claims/[id]/receipt
// Mints a short-lived signed URL for the receipt attached to an expense claim,
// authorized to whoever may DECIDE that claim: the store manager scoped to the claim's
// store, OR company-wide HR. The path is taken from the claim row, never from the
// client, so a caller cannot sign an arbitrary object.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: claim, error: loadErr } = await service
    .from('hr_claims')
    .select('id, store_id, receipt_path')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load claim' }, { status: 500 });
  if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

  // Same authorization surface as the decide route: store-scoped manager for the
  // claim's store, or company-wide HR when the claim has no store.
  const auth = claim.store_id
    ? await requireStoreManager(claim.store_id as string)
    : await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!claim.receipt_path) {
    return NextResponse.json({ error: 'This claim has no receipt' }, { status: 404 });
  }

  const { data, error } = await service.storage
    .from(BUCKET)
    // download: true -> Content-Disposition: attachment (self-XSS mitigation for a
    // document with a spoofed MIME type).
    .createSignedUrl(claim.receipt_path as string, SIGNED_URL_TTL_SECONDS, { download: true });
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Cannot sign url' }, { status: 404 });
  }
  return NextResponse.json({ url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS });
}
