import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { loadLeaveQuotaContext } from '@/lib/hr/leave-quota';
import { logHrAudit } from '@/lib/hr/audit';
import { notifyHrManagers } from '@/lib/hr/notify';
import { todayBangkok } from '@/lib/utils/date';
import {
  isCalendarDate,
  countLeaveDays,
  validateLeaveRequest,
} from '@/lib/hr/leaves';
import type { LeaveType } from '@/lib/hr/leaves';

const TABLE = 'hr_leaves';
const BUCKET = 'hr-documents';
const MAX_OPEN_LEAVES = 20;
const MAX_CERT_BYTES = 10 * 1024 * 1024; // 10MB

const LEAVE_TYPE_COLS =
  'id, company_id, code, name_th, name_en, paid, requires_cert, requires_reason, ' +
  'annual_quota_days, max_consecutive_days, probational_allowed, advance_notice_days, ' +
  'paid_percent, sort_order, active, deduct_sc, deduct_travel, paid_with_cert, cert_threshold_days';

const COLS =
  'id, user_id, store_id, company_id, leave_type_id, from_date, to_date, days, reason, ' +
  'cert_path, status, approver_id, decided_at, decision_note, created_at, updated_at';

// Detect the file type from magic bytes so only real images / PDFs reach storage.
// Returns the storage extension + content type, or null when unrecognised.
function sniffCert(buffer: Buffer): { ext: string; contentType: string } | null {
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

// POST /api/hr/ess/leaves — an employee files a leave request (§E). multipart/form-data
// so a supporting certificate can be attached. Auth-any: the caller is always the
// requester. The store is derived SERVER-SIDE (schedule cell, else store membership) —
// never from client input — and the day count / validation run against the leave engine.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });

  const leaveTypeId = typeof form.get('leave_type_id') === 'string' ? String(form.get('leave_type_id')) : '';
  const fromDate = typeof form.get('from_date') === 'string' ? String(form.get('from_date')) : '';
  const toDate = typeof form.get('to_date') === 'string' ? String(form.get('to_date')) : '';
  const reason = typeof form.get('reason') === 'string' ? String(form.get('reason')).trim() : '';
  const certField = form.get('cert');
  const certFile = certField && typeof certField === 'object' && 'arrayBuffer' in certField
    ? (certField as File)
    : null;

  if (!leaveTypeId) return NextResponse.json({ error: 'leave_type_id is required' }, { status: 400 });
  if (!isCalendarDate(fromDate) || !isCalendarDate(toDate)) {
    return NextResponse.json({ error: 'Invalid from_date or to_date' }, { status: 400 });
  }
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'to_date must be on or after from_date' }, { status: 400 });
  }
  // reason requirement is per leave type (requires_reason) — checked after the type loads below.

  const service = createServiceClient();

  // The caller must be a registered employee — that row fixes company + work hours.
  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .select('id, company_id, work_hours_per_day, probation_end')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to load employee' }, { status: 500 });
  if (!emp || !emp.company_id) {
    return NextResponse.json({ error: 'You are not registered as an employee' }, { status: 400 });
  }
  const companyId = emp.company_id as string;

  // Load the leave type. Types may be shared (company_id null) or company-scoped.
  const { data: leaveTypeRow, error: ltErr } = await service
    .from('hr_leave_types')
    .select(LEAVE_TYPE_COLS)
    .eq('id', leaveTypeId)
    .maybeSingle();
  if (ltErr) return NextResponse.json({ error: 'Failed to load leave type' }, { status: 500 });
  if (!leaveTypeRow) return NextResponse.json({ error: 'Leave type not found' }, { status: 400 });
  const leaveType = leaveTypeRow as unknown as LeaveType;
  if (leaveType.company_id != null && leaveType.company_id !== companyId) {
    return NextResponse.json({ error: 'Leave type not available for your company' }, { status: 400 });
  }
  // A reason is required unless the type explicitly opts out (requires_reason=false). Previously
  // this was unconditional, making the config flag inert (audit gap #8).
  if (leaveType.requires_reason !== false && !reason) {
    return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
  }

  // Raw calendar-day count. Roster day-offs are excluded at approval time (see the decide
  // route), because a leave filed for future dates has no roster row to check yet.
  const days = countLeaveDays(fromDate, toDate);
  if (days <= 0) {
    return NextResponse.json({ error: 'Leave range contains no working days' }, { status: 400 });
  }

  // Optional certificate: validate size + magic bytes, then upload to the private
  // bucket. We persist only the storage path. The upload happens BEFORE the final
  // validation/insert, so any later failure must remove the object (best-effort) to
  // avoid orphans — tracked via `certPath`.
  let certPath: string | null = null;
  const hasCert = Boolean(certFile);
  const removeCert = async () => {
    if (certPath) await service.storage.from(BUCKET).remove([certPath]).catch(() => {});
  };

  if (certFile) {
    if (certFile.size <= 0 || certFile.size > MAX_CERT_BYTES) {
      return NextResponse.json({ error: 'Certificate is empty or exceeds 10MB' }, { status: 400 });
    }
    const buffer = Buffer.from(await certFile.arrayBuffer());
    const sniff = sniffCert(buffer);
    if (!sniff) {
      return NextResponse.json(
        { error: 'Certificate must be a JPEG, PNG, WebP, or PDF' },
        { status: 400 }
      );
    }
    const path = `leaves/${user.id}/${crypto.randomUUID()}.${sniff.ext}`;
    const { error: uploadErr } = await service.storage.from(BUCKET).upload(path, buffer, {
      contentType: sniff.contentType,
      cacheControl: '3600',
      upsert: false,
    });
    if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    certPath = path;
  }

  const today = todayBangkok();
  const isProbation = Boolean(emp.probation_end) && today <= (emp.probation_end as string);

  // Quota context: the per-employee override (hr_leave_balances, 00165 — the legacy sheet's
  // per-person "พักร้อนคงเหลือ") beats the type default, and requests still in the queue count
  // alongside approved ones. Shared with /hr/leaves and the approval route so all three agree.
  const year = Number(today.slice(0, 4));
  const quotaCtx = await loadLeaveQuotaContext(service, {
    employeeId: emp.id as string,
    profileId: user.id,
    leaveTypeId,
    typeQuotaDays: leaveType.annual_quota_days,
    year,
  });
  const effectiveType = { ...leaveType, annual_quota_days: quotaCtx.effectiveQuota };

  const validation = validateLeaveRequest({
    leaveType: effectiveType,
    fromDate,
    toDate,
    days,
    hasCert,
    today,
    isProbation,
    usedDaysThisYear: quotaCtx.approved,
    pendingThisYear: quotaCtx.pending,
  });
  if (!validation.ok) {
    await removeCert();
    return NextResponse.json(
      { error: validation.error, code: validation.code, quota: validation.quota },
      { status: 400 }
    );
  }

  // Derive the store server-side: the schedule cell on from_date, else the caller's
  // first store membership, else null (company-wide leave).
  let storeId: string | null = null;
  const { data: cell } = await service
    .from('hr_schedule')
    .select('store_id')
    .eq('user_id', user.id)
    .eq('work_date', fromDate)
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

  // Abuse guard: cap open (pending) requests. The partial-unique index is the
  // race-proof backstop for exact-range duplicates. Fail CLOSED on a query error —
  // never let a transient DB blip silently bypass the cap.
  const { data: pendings, error: pendingsErr } = await service
    .from(TABLE)
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'pending');
  if (pendingsErr) {
    await removeCert();
    return NextResponse.json({ error: 'Failed to check open leave requests' }, { status: 500 });
  }
  if ((pendings ?? []).length >= MAX_OPEN_LEAVES) {
    await removeCert();
    return NextResponse.json({ error: 'Too many open leave requests' }, { status: 429 });
  }

  const { data, error } = await service
    .from(TABLE)
    .insert({
      user_id: user.id,
      store_id: storeId,
      company_id: companyId,
      leave_type_id: leaveTypeId,
      from_date: fromDate,
      to_date: toDate,
      days,
      reason,
      cert_path: certPath,
      status: 'pending',
    })
    .select(COLS)
    .single();
  if (error) {
    await removeCert();
    // 23505 = the partial-unique index caught a concurrent / duplicate pending range.
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'You already have a pending leave request for these dates' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Failed to file leave request' }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: user.id,
    action: 'create',
    table: TABLE,
    recordId: (data as unknown as { id: string }).id,
    after: data as unknown as Record<string, unknown>,
    reason: `Leave requested: ${leaveType.code}`,
  });

  // Notify HR/managers that a leave request is waiting (best-effort — must never fail the request).
  try {
    const { data: prof } = await service
      .from('profiles')
      .select('display_name, username')
      .eq('id', user.id)
      .maybeSingle();
    const who = prof?.display_name || prof?.username || '—';
    const range = fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`;
    await notifyHrManagers(service, {
      storeId,
      type: 'hr_leave_request',
      title: 'คำขอลา — รออนุมัติ',
      body: `${who} ขอ${leaveType.name_th} ${range} (${days} วัน)`,
      data: { leave_id: (data as unknown as { id: string }).id, url: '/hr/leaves' },
      excludeUserId: user.id,
    });
  } catch (e) {
    console.error('[ess/leaves] notify HR failed:', e);
  }

  return NextResponse.json({ data }, { status: 201 });
}

// GET /api/hr/ess/leaves — the caller's own leave requests, newest first.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .select(`${COLS}, leave_type:hr_leave_types(code, name_th, name_en)`)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load leaves' }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
