import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const BUCKET = 'hr-documents';
const SIGNED_TTL = 300;

// GET /api/hr/ess/document-requests/[id]/file — the employee opens their READY document:
// either the system-generated figures (generated_data) or a signed URL to the attached file.
// Strictly own-request.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();
  const { data: reqRow, error } = await service
    .from('hr_document_requests')
    .select('id, profile_id, status, fulfillment, file_path, generated_data, doc_type, year')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Failed to load request' }, { status: 500 });
  if (!reqRow || reqRow.profile_id !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (reqRow.status !== 'ready') return NextResponse.json({ error: 'Not ready yet' }, { status: 409 });

  if (reqRow.fulfillment === 'generated') {
    return NextResponse.json({ data: { kind: 'generated', doc_type: reqRow.doc_type, year: reqRow.year, generated: reqRow.generated_data } });
  }
  if (reqRow.fulfillment === 'file' && reqRow.file_path) {
    const { data, error: signErr } = await service.storage
      .from(BUCKET)
      .createSignedUrl(reqRow.file_path as string, SIGNED_TTL, { download: true });
    if (signErr || !data) return NextResponse.json({ error: 'Cannot sign url' }, { status: 404 });
    return NextResponse.json({ data: { kind: 'file', url: data.signedUrl, expiresIn: SIGNED_TTL } });
  }
  return NextResponse.json({ error: 'Nothing to download' }, { status: 404 });
}
