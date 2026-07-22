import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logHrAudit } from '@/lib/hr/audit';
import { isUniqueViolation } from '@/lib/hr/db-errors';
import { isCalendarDate } from '@/lib/hr/leaves';
import { notifyHrManagers } from '@/lib/hr/notify';
import { BUCKET, decodeSignaturePng } from '@/lib/hr/warnings';
import { todayBangkok } from '@/lib/utils/date';

const TABLE = 'hr_resignation_requests';

const COLS =
  'id, user_id, company_id, store_id, notice_date, last_working_date, reason, ' +
  'signature_path, status, offboarding_id, reviewed_by, reviewed_at, review_note, ' +
  'created_at, updated_at';

// GET /api/hr/ess/resignation — the caller's OWN resignation requests, newest first.
// Auth-any: never exposes anyone else's requests.
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
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

// POST /api/hr/ess/resignation — the EMPLOYEE submits their own resignation notice.
// Body: { last_working_date?, reason?, signature: "data:image/png;base64,..." }.
// notice_date is stamped server-side (today, Bangkok). Guards: must be a registered HR
// employee; one pending request per person (unique index → 409); blocked while an
// offboarding is already in progress. HR is notified; HR later accepts (auto-creating
// the offboarding draft) or rejects on the offboarding page.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const lastWorkingDate =
    typeof body.last_working_date === 'string' && body.last_working_date ? body.last_working_date : null;
  const reason = typeof body.reason === 'string' ? body.reason.trim() || null : null;

  const noticeDate = todayBangkok();
  if (lastWorkingDate !== null) {
    if (!isCalendarDate(lastWorkingDate)) {
      return NextResponse.json({ error: 'last_working_date is not a valid date' }, { status: 400 });
    }
    if (lastWorkingDate < noticeDate) {
      return NextResponse.json(
        { error: 'last_working_date must not be before the notice date' },
        { status: 400 }
      );
    }
  }

  const decoded = decodeSignaturePng(body.signature);
  if (!decoded.ok) return NextResponse.json({ error: decoded.error }, { status: 400 });

  const service = createServiceClient();

  // Must be a registered HR employee — that record supplies the company.
  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .select('company_id, status')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to resolve employee' }, { status: 500 });
  if (!emp) return NextResponse.json({ error: 'Employee record not found' }, { status: 400 });
  if (emp.status === 'resigned' || emp.status === 'terminated') {
    return NextResponse.json({ error: 'You are no longer an active employee' }, { status: 409 });
  }

  // Blocked while an offboarding is already in progress (HR already handling it).
  const { data: openOffb } = await service
    .from('hr_offboarding')
    .select('id')
    .eq('user_id', user.id)
    .in('status', ['draft', 'pending_signoff'])
    .limit(1)
    .maybeSingle();
  if (openOffb) {
    return NextResponse.json(
      { error: 'An offboarding is already in progress for you' },
      { status: 409 }
    );
  }

  // store_id: the employee's first store membership (nullable).
  const { data: membership } = await service
    .from('user_stores')
    .select('store_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  const storeId = (membership?.store_id as string | undefined) ?? null;

  // Upload the signed letter first (path needs the id), then insert with that id so a
  // unique-violation cleanup can remove the file again.
  const id = randomUUID();
  const signaturePath = `resignation/${id}/employee-${user.id}.png`;
  const { error: uploadErr } = await service.storage
    .from(BUCKET)
    .upload(signaturePath, decoded.buffer, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: true,
    });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { data: created, error: insertErr } = await service
    .from(TABLE)
    .insert({
      id,
      user_id: user.id,
      company_id: (emp.company_id as string | null) ?? null,
      store_id: storeId,
      notice_date: noticeDate,
      last_working_date: lastWorkingDate,
      reason,
      signature_path: signaturePath,
      status: 'pending',
    })
    .select(COLS)
    .single();
  if (insertErr) {
    await service.storage.from(BUCKET).remove([signaturePath]).catch(() => {});
    if (isUniqueViolation(insertErr)) {
      return NextResponse.json(
        { error: 'You already have a pending resignation request' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Failed to submit resignation request' }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: user.id,
    action: 'create',
    table: TABLE,
    recordId: id,
    after: created as unknown as Record<string, unknown>,
    reason: 'Resignation request submitted by employee',
  });

  // Notify HR (best-effort — never fail the submission).
  try {
    const { data: prof } = await service
      .from('profiles')
      .select('display_name, username')
      .eq('id', user.id)
      .maybeSingle();
    const name = prof?.display_name || prof?.username || 'พนักงาน';
    await notifyHrManagers(service, {
      storeId,
      type: 'hr_resignation_request',
      title: 'มีใบลาออกใหม่',
      body: `${name} ยื่นใบลาออก (แจ้งวันที่ ${noticeDate}) — รอฝ่ายบุคคลรับเรื่อง`,
      data: { url: '/hr/offboarding' },
      excludeUserId: user.id,
    });
  } catch {
    /* best-effort */
  }

  return NextResponse.json({ data: created }, { status: 201 });
}
