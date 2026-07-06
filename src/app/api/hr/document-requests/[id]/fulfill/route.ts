import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyUser } from '@/lib/notifications/service';
import { generate50Twi, generateSalaryCert } from '@/lib/hr/document-request';

// POST /api/hr/document-requests/[id]/fulfill { action: 'generate' | 'reject', note? }
// (⑥) — HR either SYSTEM-GENERATES the figures (50 ทวิ / salary certificate we can derive from
// finalized payslips) or rejects with a reason. The FILE path (accountant-provided PDF) is the
// separate /upload route. Employee is notified either way.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : null;

  const service = createServiceClient();
  const { data: reqRow, error } = await service
    .from('hr_document_requests')
    .select('id, profile_id, doc_type, year, status')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Failed to load request' }, { status: 500 });
  if (!reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  if (reqRow.status !== 'requested') return NextResponse.json({ error: 'Already decided' }, { status: 409 });

  const period = reqRow.year ? ` ${reqRow.year}` : '';

  if (action === 'reject') {
    if (!note) return NextResponse.json({ error: 'Reason required to reject' }, { status: 400 });
    await service.from('hr_document_requests').update({ status: 'rejected', decided_by: auth.userId, decided_at: new Date().toISOString(), decision_note: note }).eq('id', id).eq('status', 'requested');
    await logHrAudit(service, { actorId: auth.userId, action: 'update', table: 'hr_document_requests', recordId: id, before: { status: 'requested' }, after: { status: 'rejected' }, reason: note });
    try {
      await notifyUser({ userId: reqRow.profile_id as string, storeId: null, type: 'hr_doc_ready', title: 'คำขอเอกสารไม่ผ่าน', body: `คำขอเอกสาร (${reqRow.doc_type}${period}) ไม่ได้รับการอนุมัติ — ${note}`, data: { url: '/me/documents' } });
    } catch (e) { console.error('[fulfill/reject] notify failed:', e); }
    return NextResponse.json({ data: { status: 'rejected' } });
  }

  if (action !== 'generate') return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  // system-generate the figures we can derive
  let generated: unknown;
  if (reqRow.doc_type === 'cert_50twi') {
    const r = await generate50Twi(service, reqRow.profile_id as string, reqRow.year as number);
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 });
    generated = r;
  } else if (reqRow.doc_type === 'salary_cert') {
    const r = await generateSalaryCert(service, reqRow.profile_id as string);
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 });
    generated = r;
  } else {
    return NextResponse.json({ error: 'This document type cannot be system-generated — attach a file instead' }, { status: 400 });
  }

  const { error: updErr } = await service
    .from('hr_document_requests')
    .update({ status: 'ready', fulfillment: 'generated', generated_data: generated, decided_by: auth.userId, decided_at: new Date().toISOString(), decision_note: note })
    .eq('id', id)
    .eq('status', 'requested');
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await logHrAudit(service, { actorId: auth.userId, action: 'update', table: 'hr_document_requests', recordId: id, before: { status: 'requested' }, after: { status: 'ready', fulfillment: 'generated' }, reason: 'Document generated' });
  try {
    await notifyUser({ userId: reqRow.profile_id as string, storeId: null, type: 'hr_doc_ready', title: 'เอกสารพร้อมแล้ว', body: `เอกสาร (${reqRow.doc_type}${period}) พร้อมเปิดดูในแอปแล้ว`, data: { url: '/me/documents' } });
  } catch (e) { console.error('[fulfill/generate] notify failed:', e); }

  return NextResponse.json({ data: { status: 'ready', fulfillment: 'generated' } });
}
