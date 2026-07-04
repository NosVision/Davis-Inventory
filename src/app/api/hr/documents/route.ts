import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForEmployeeId } from '@/lib/hr/route-auth';

const BUCKET = 'hr-documents';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const SIGNED_URL_TTL_SECONDS = 300;

// POST /api/hr/documents  (multipart: file, employeeId)
// Uploads a sensitive HR document to the PRIVATE bucket. Returns { path, name } — NOT a url.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get('file');
  const employeeId = String(form.get('employeeId') ?? 'unassigned');

  // §P5.5: the document folder is keyed by hr_employees.id — only company-wide HR or a manager
  // whose stores include this employee may upload into it (an 'unassigned' create → HR only).
  const auth = await requireHrManagerForEmployeeId(employeeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: `Unsupported type ${file.type}` }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File exceeds 10MB' }, { status: 400 });
  }

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeEmployee = employeeId.replace(/[^a-zA-Z0-9-]/g, '') || 'unassigned';
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${safeEmployee}/${Date.now()}-${rand}.${ext}`;

  const service = createServiceClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await service.storage.from(BUCKET).upload(path, buffer, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ path, name: file.name }, { status: 201 });
}

// GET /api/hr/documents?path=<storage-path>
// Mints a short-lived signed URL to view a private HR document.
export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'path is required' }, { status: 400 });

  // §P5.5: the first path segment is the employee's hr_employees.id folder — gate on it so a
  // scoped manager can only sign URLs for documents of employees in their stores.
  const employeeFolder = path.split('/')[0] ?? '';
  const auth = await requireHrManagerForEmployeeId(employeeFolder);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  // download: true -> Content-Disposition: attachment, so a document with a spoofed
  // MIME type cannot be rendered inline (self-XSS/HTML-injection mitigation).
  const { data, error } = await service.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: true });
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Cannot sign url' }, { status: 404 });
  }
  return NextResponse.json({ url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS });
}
