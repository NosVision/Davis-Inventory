import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, requireStoreManager } from '@/lib/hr/route-auth';

const BUCKET = 'hr-documents';
const SIGNED_URL_TTL_SECONDS = 300;

// GET /api/hr/leaves/[id]/cert
// Mints a short-lived signed URL for the certificate attached to a leave request,
// authorized to whoever may DECIDE that leave: the store manager scoped to the
// leave's store, OR company-wide HR. The generic /api/hr/documents viewer is gated
// to requireHrManager() only, so a store-scoped manager (hr_manager_scopes) could
// approve a sick leave but not open the certificate that determines whether it is
// paid (§H) — this route closes that gap. The path is taken from the leave row, never
// from the client, so a caller cannot sign an arbitrary object.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: leave, error: loadErr } = await service
    .from('hr_leaves')
    .select('id, store_id, cert_path')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load leave' }, { status: 500 });
  if (!leave) return NextResponse.json({ error: 'Leave not found' }, { status: 404 });

  // Same authorization surface as the decide route: store-scoped manager for the
  // leave's store, or company-wide HR when the leave has no store.
  const auth = leave.store_id
    ? await requireStoreManager(leave.store_id as string)
    : await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!leave.cert_path) {
    return NextResponse.json({ error: 'This leave has no certificate' }, { status: 404 });
  }

  const { data, error } = await service.storage
    .from(BUCKET)
    // download: true -> Content-Disposition: attachment (self-XSS mitigation for a
    // document with a spoofed MIME type).
    .createSignedUrl(leave.cert_path as string, SIGNED_URL_TTL_SECONDS, { download: true });
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Cannot sign url' }, { status: 404 });
  }
  return NextResponse.json({ url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS });
}
