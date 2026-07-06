import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyUser } from '@/lib/notifications/service';

const BUCKET = 'hr-documents';
const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

// POST /api/hr/document-requests/[id]/upload (multipart: file) — HR attaches the
// accountant-produced document (50 ทวิ PDF, salary letter, …). Stored in the PRIVATE
// hr-documents bucket under docreq/<request-id>/; the employee reads it via a signed URL. (⑥)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data: reqRow, error } = await service
    .from('hr_document_requests')
    .select('id, profile_id, doc_type, year, status')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Failed to load request' }, { status: 500 });
  if (!reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  if (reqRow.status !== 'requested') return NextResponse.json({ error: 'Already decided' }, { status: 409 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: `Unsupported type ${file.type}` }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File exceeds 10MB' }, { status: 400 });

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `docreq/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await service.storage.from(BUCKET).upload(path, buffer, { contentType: file.type, cacheControl: '3600', upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { error: updErr } = await service
    .from('hr_document_requests')
    .update({ status: 'ready', fulfillment: 'file', file_path: path, decided_by: auth.userId, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'requested');
  if (updErr) {
    await service.storage.from(BUCKET).remove([path]).catch(() => {});
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logHrAudit(service, { actorId: auth.userId, action: 'update', table: 'hr_document_requests', recordId: id, before: { status: 'requested' }, after: { status: 'ready', fulfillment: 'file' }, reason: 'Document file attached' });
  try {
    const period = reqRow.year ? ` ${reqRow.year}` : '';
    await notifyUser({ userId: reqRow.profile_id as string, storeId: null, type: 'hr_doc_ready', title: 'เอกสารพร้อมแล้ว', body: `เอกสาร (${reqRow.doc_type}${period}) พร้อมดาวน์โหลดในแอปแล้ว`, data: { url: '/me/documents' } });
  } catch (e) { console.error('[document upload] notify failed:', e); }

  return NextResponse.json({ data: { status: 'ready', fulfillment: 'file' } }, { status: 201 });
}
