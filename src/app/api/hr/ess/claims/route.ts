import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logHrAudit } from '@/lib/hr/audit';
import { isCalendarDate } from '@/lib/hr/leaves';

const TABLE = 'hr_claims';
const BUCKET = 'hr-documents';
const MAX_OPEN_CLAIMS = 30;
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_AMOUNT_SATANG = 100000000; // ฿1,000,000 sanity ceiling

const CLAIM_TYPES = ['travel', 'medical', 'supplies', 'equipment', 'other'];

const COLS =
  'id, user_id, store_id, company_id, claim_type, amount_satang, description, ' +
  'receipt_path, claim_date, status, approver_id, decided_at, decision_note, ' +
  'paid_at, payslip_earning_id, created_at, updated_at';

// Detect the file type from magic bytes so only real images / PDFs reach storage.
// Returns the storage extension + content type, or null when unrecognised.
function sniffReceipt(buffer: Buffer): { ext: string; contentType: string } | null {
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

// POST /api/hr/ess/claims — an employee files an expense claim (§J2). multipart/form-data
// because a receipt image is REQUIRED (a claim needs a bill). Auth-any: the caller is
// always the claimant. The store is derived SERVER-SIDE (schedule cell on claim_date,
// else store membership) — never from client input.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });

  const claimType = typeof form.get('claim_type') === 'string' ? String(form.get('claim_type')) : '';
  const amountRaw = typeof form.get('amount_satang') === 'string' ? String(form.get('amount_satang')).trim() : '';
  const description = typeof form.get('description') === 'string' ? String(form.get('description')).trim() : '';
  const claimDate = typeof form.get('claim_date') === 'string' ? String(form.get('claim_date')) : '';
  const receiptField = form.get('receipt');
  const receiptFile = receiptField && typeof receiptField === 'object' && 'arrayBuffer' in receiptField
    ? (receiptField as File)
    : null;

  if (!CLAIM_TYPES.includes(claimType)) {
    return NextResponse.json({ error: 'Invalid claim_type' }, { status: 400 });
  }
  // amount_satang must be a positive integer within the sanity ceiling.
  if (!/^\d+$/.test(amountRaw)) {
    return NextResponse.json({ error: 'amount_satang must be a positive integer' }, { status: 400 });
  }
  const amountSatang = Number(amountRaw);
  if (!Number.isInteger(amountSatang) || amountSatang <= 0 || amountSatang > MAX_AMOUNT_SATANG) {
    return NextResponse.json({ error: 'amount_satang is out of range' }, { status: 400 });
  }
  if (!description) return NextResponse.json({ error: 'A description is required' }, { status: 400 });
  if (!isCalendarDate(claimDate)) {
    return NextResponse.json({ error: 'Invalid claim_date' }, { status: 400 });
  }
  if (!receiptFile) return NextResponse.json({ error: 'A receipt is required' }, { status: 400 });

  const service = createServiceClient();

  // The caller must be a registered employee — that row fixes company.
  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .select('company_id')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to load employee' }, { status: 500 });
  // Require a company (mirrors leaves): an approved claim becomes a payslip earning in P4,
  // and payroll runs per-company — a NULL company_id would silently orphan the money.
  if (!emp || !emp.company_id) {
    return NextResponse.json({ error: 'You are not registered as an employee' }, { status: 400 });
  }
  const companyId = emp.company_id as string;

  // Upload the receipt: validate size + magic bytes, then upload to the private
  // bucket. We persist only the storage path. The upload happens BEFORE the insert,
  // so any later failure must remove the object (best-effort) to avoid orphans —
  // tracked via `receiptPath`.
  let receiptPath: string | null = null;
  const removeReceipt = async () => {
    if (receiptPath) await service.storage.from(BUCKET).remove([receiptPath]).catch(() => {});
  };

  if (receiptFile.size <= 0 || receiptFile.size > MAX_RECEIPT_BYTES) {
    return NextResponse.json({ error: 'Receipt is empty or exceeds 10MB' }, { status: 400 });
  }
  const buffer = Buffer.from(await receiptFile.arrayBuffer());
  const sniff = sniffReceipt(buffer);
  if (!sniff) {
    return NextResponse.json(
      { error: 'Receipt must be a JPEG, PNG, WebP, or PDF' },
      { status: 400 }
    );
  }
  const path = `claims/${user.id}/${crypto.randomUUID()}.${sniff.ext}`;
  const { error: uploadErr } = await service.storage.from(BUCKET).upload(path, buffer, {
    contentType: sniff.contentType,
    cacheControl: '3600',
    upsert: false,
  });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  receiptPath = path;

  // Derive the store server-side: the schedule cell on claim_date, else the caller's
  // first store membership, else null.
  let storeId: string | null = null;
  const { data: cell } = await service
    .from('hr_schedule')
    .select('store_id')
    .eq('user_id', user.id)
    .eq('work_date', claimDate)
    .maybeSingle();
  if (cell?.store_id) {
    storeId = cell.store_id as string;
  } else {
    const { data: membership } = await service
      .from('user_stores')
      .select('store_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    storeId = (membership?.store_id as string) ?? null;
  }

  // Abuse guard: cap open (pending) claims. Fail CLOSED on a query error — never let a
  // transient DB blip silently bypass the cap.
  const { data: pendings, error: pendingsErr } = await service
    .from(TABLE)
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'pending');
  if (pendingsErr) {
    await removeReceipt();
    return NextResponse.json({ error: 'Failed to check open claims' }, { status: 500 });
  }
  if ((pendings ?? []).length >= MAX_OPEN_CLAIMS) {
    await removeReceipt();
    return NextResponse.json({ error: 'Too many open claims' }, { status: 429 });
  }

  const { data, error } = await service
    .from(TABLE)
    .insert({
      user_id: user.id,
      store_id: storeId,
      company_id: companyId,
      claim_type: claimType,
      amount_satang: amountSatang,
      description,
      receipt_path: receiptPath,
      claim_date: claimDate,
      status: 'pending',
    })
    .select(COLS)
    .single();
  if (error) {
    await removeReceipt();
    return NextResponse.json({ error: 'Failed to file claim' }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: user.id,
    action: 'create',
    table: TABLE,
    recordId: (data as unknown as { id: string }).id,
    after: data as unknown as Record<string, unknown>,
    reason: `Claim filed: ${claimType}`,
  });

  return NextResponse.json({ data }, { status: 201 });
}

// GET /api/hr/ess/claims — the caller's own claims, newest first.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .select(COLS)
    .eq('user_id', user.id)
    .order('claim_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load claims' }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
