import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyHrManagers } from '@/lib/hr/notify';

const DOC_TYPES = ['cert_50twi', 'salary_cert', 'slip_copy', 'other'];

// GET /api/hr/ess/document-requests — the caller's own requests + statuses.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_document_requests')
    .select('id, doc_type, year, note, status, fulfillment, decided_at, decision_note, created_at')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// POST /api/hr/ess/document-requests { doc_type, year?, note? } — file a personal-document request.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const docType = typeof body.doc_type === 'string' ? body.doc_type : '';
  if (!DOC_TYPES.includes(docType)) return NextResponse.json({ error: 'Invalid doc_type' }, { status: 400 });
  const year = Number.isInteger(Number(body.year)) ? Number(body.year) : null;
  if ((docType === 'cert_50twi') && (!year || year < 2000 || year > 2100)) {
    return NextResponse.json({ error: 'year is required for 50 ทวิ' }, { status: 400 });
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : null;

  const service = createServiceClient();
  // guard against duplicate open requests for the same doc/year (.is only handles null/booleans,
  // so a numeric year needs .eq)
  let dupQuery = service
    .from('hr_document_requests')
    .select('id')
    .eq('profile_id', user.id)
    .eq('doc_type', docType)
    .eq('status', 'requested');
  dupQuery = year === null ? dupQuery.is('year', null) : dupQuery.eq('year', year);
  const { data: dup } = await dupQuery.maybeSingle();
  if (dup) return NextResponse.json({ error: 'You already have an open request for this document' }, { status: 409 });

  const { data: created, error } = await service
    .from('hr_document_requests')
    .insert({ profile_id: user.id, doc_type: docType, year, note })
    .select('id, status')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    const { data: prof } = await service.from('profiles').select('display_name, username').eq('id', user.id).maybeSingle();
    const { data: us } = await service.from('user_stores').select('store_id').eq('user_id', user.id).limit(1).maybeSingle();
    await notifyHrManagers(service, {
      storeId: (us?.store_id as string | null) ?? null,
      type: 'hr_doc_request',
      title: 'คำขอเอกสารใหม่',
      body: `${prof?.display_name || prof?.username || 'พนักงาน'} ขอเอกสาร (${docType}${year ? ` ${year}` : ''})`,
      data: { request_id: created.id, url: '/hr/document-requests' },
      excludeUserId: user.id,
    });
  } catch (e) {
    console.error('[ess/document-requests] notify failed:', e);
  }

  return NextResponse.json({ data: { id: created.id, status: created.status } }, { status: 201 });
}
