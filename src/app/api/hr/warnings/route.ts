import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { BUCKET, deriveScEffect, isWarningLevel } from '@/lib/hr/warnings';

const TABLE = 'hr_warnings';
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024; // 10MB

const COLS =
  'id, user_id, issued_by, store_id, company_id, level, sc_deduct_percent, amount_satang, ' +
  'sc_deduct_cycles, reason, detail, evidence_path, issued_at, expires_at, status, void_reason, ' +
  'created_at, updated_at';

const EMPLOYEE_EMBED =
  'employee:profiles!hr_warnings_user_id_fkey(id, display_name, username)';
const ISSUER_EMBED =
  'issuer:profiles!hr_warnings_issued_by_fkey(id, display_name, username)';
const SIGNATURES_EMBED = 'signatures:hr_warning_signatures(role, signed_by, signed_at)';

// Detect the evidence file type from magic bytes so only real images / PDFs reach
// storage. Returns the storage extension + content type, or null when unrecognised.
function sniffEvidence(buffer: Buffer): { ext: string; contentType: string } | null {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { ext: 'pdf', contentType: 'application/pdf' };
  }
  return null;
}

// POST /api/hr/warnings — HR or a store manager issues a disciplinary warning (§E).
// multipart/form-data so an optional evidence image/PDF can be attached. The SC
// deduction intent is derived SERVER-SIDE from the level (never trusted from the
// client). Warnings deduct from Service Charge only; here we just RECORD the intent —
// the money LINE lands in P4.
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });

  const userId = typeof form.get('user_id') === 'string' ? String(form.get('user_id')).trim() : '';
  const storeIdRaw = typeof form.get('store_id') === 'string' ? String(form.get('store_id')).trim() : '';
  const storeId = storeIdRaw || null;
  const level = typeof form.get('level') === 'string' ? String(form.get('level')) : '';
  const reason = typeof form.get('reason') === 'string' ? String(form.get('reason')).trim() : '';
  const detailRaw = typeof form.get('detail') === 'string' ? String(form.get('detail')).trim() : '';
  const detail = detailRaw || null;
  const amountRaw = form.get('amount_satang');
  const evidenceField = form.get('evidence');
  const evidenceFile =
    evidenceField && typeof evidenceField === 'object' && 'arrayBuffer' in evidenceField
      ? (evidenceField as File)
      : null;

  // Auth: store-scoped when a store is given, otherwise company-wide HR.
  const auth = storeId ? await requireStoreManager(storeId) : await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!userId) return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  if (!isWarningLevel(level)) {
    return NextResponse.json({ error: 'level must be one of the six disciplinary levels' }, { status: 400 });
  }
  if (!reason) return NextResponse.json({ error: 'A reason is required' }, { status: 400 });

  // amount_satang: only meaningful for level='amount_baht'. Parse when present so
  // deriveScEffect can validate it; ignored (forced null) for every other level.
  const amountSatang =
    typeof amountRaw === 'string' && amountRaw.trim() !== '' ? Number(amountRaw) : undefined;
  const sc = deriveScEffect(level, amountSatang);
  if (!sc.ok) return NextResponse.json({ error: sc.error }, { status: 400 });

  const service = createServiceClient();

  // The employee must resolve to a real profile.
  const { data: profile, error: profileErr } = await service
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (profileErr) return NextResponse.json({ error: 'Failed to resolve employee' }, { status: 500 });
  if (!profile) return NextResponse.json({ error: 'Employee not found' }, { status: 400 });

  // Derive company_id from the employee record (keyed by profile_id). Nullable when
  // the person is not (yet) a registered HR employee.
  const { data: emp } = await service
    .from('hr_employees')
    .select('company_id')
    .eq('profile_id', userId)
    .maybeSingle();
  const companyId = (emp?.company_id as string | undefined) ?? null;

  // Optional evidence: validate size + magic bytes, upload to the private bucket. The
  // upload happens BEFORE the insert, so any later failure must remove the object
  // (best-effort) to avoid orphans — tracked via `evidencePath`.
  let evidencePath: string | null = null;
  if (evidenceFile) {
    if (evidenceFile.size <= 0 || evidenceFile.size > MAX_EVIDENCE_BYTES) {
      return NextResponse.json({ error: 'Evidence is empty or exceeds 10MB' }, { status: 400 });
    }
    const buffer = Buffer.from(await evidenceFile.arrayBuffer());
    const sniff = sniffEvidence(buffer);
    if (!sniff) {
      return NextResponse.json({ error: 'Evidence must be a JPEG, PNG, WebP, or PDF' }, { status: 400 });
    }
    const path = `warnings/evidence/${crypto.randomUUID()}.${sniff.ext}`;
    const { error: uploadErr } = await service.storage.from(BUCKET).upload(path, buffer, {
      contentType: sniff.contentType,
      cacheControl: '3600',
      upsert: false,
    });
    if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    evidencePath = path;
  }

  const { data, error } = await service
    .from(TABLE)
    .insert({
      user_id: userId,
      issued_by: auth.userId,
      store_id: storeId,
      company_id: companyId,
      level,
      sc_deduct_percent: sc.sc_deduct_percent,
      amount_satang: sc.amount_satang,
      sc_deduct_cycles: sc.sc_deduct_cycles,
      reason,
      detail,
      evidence_path: evidencePath,
      status: 'active',
    })
    .select(COLS)
    .single();
  if (error) {
    if (evidencePath) await service.storage.from(BUCKET).remove([evidencePath]).catch(() => {});
    return NextResponse.json({ error: 'Failed to issue warning' }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: TABLE,
    recordId: (data as unknown as { id: string }).id,
    after: data as unknown as Record<string, unknown>,
    reason: `Warning issued: ${level}`,
  });

  return NextResponse.json({ data }, { status: 201 });
}

// GET /api/hr/warnings — issue queue / history. Query: store_id?, status? (default
// all), user_id? (per-employee history). A store_id scopes to a store manager;
// otherwise company-wide HR is required.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeId = sp.get('store_id');
  const status = sp.get('status');
  const userId = sp.get('user_id');

  const auth = storeId ? await requireStoreManager(storeId) : await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  let query = service
    .from(TABLE)
    .select(`${COLS}, ${EMPLOYEE_EMBED}, ${ISSUER_EMBED}, ${SIGNATURES_EMBED}`);
  if (storeId) query = query.eq('store_id', storeId);
  if (status) query = query.eq('status', status);
  if (userId) query = query.eq('user_id', userId);
  query = query.order('issued_at', { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
