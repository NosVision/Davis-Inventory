import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForRowStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isUniqueViolation } from '@/lib/hr/db-errors';
import { snapshotOffboardingAssets } from '@/lib/hr/offboarding';
import { notifyUser } from '@/lib/notifications/service';

const TABLE = 'hr_resignation_requests';
const OFFB_TABLE = 'hr_offboarding';

const OFFB_COLS =
  'id, user_id, company_id, store_id, kind, reason, notice_date, last_working_date, ' +
  'severance_note, status, employee_signature_path, employee_signed_at, hr_signature_path, ' +
  'hr_signed_at, hr_signed_by, initiated_by, completed_at, created_at, updated_at, updated_by';

// POST /api/hr/resignation-requests/[id]/accept — HR accepts the employee's resignation
// notice: creates the hr_offboarding DRAFT (kind resignation, dates/reason carried over,
// asset checklist snapshotted) and links it back onto the request. company_id is
// re-derived from hr_employees at accept time (the stored one may predate a transfer).
// The offboarding one-open unique index → 409 if one is already in progress.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireHrManagerForRowStore(TABLE, id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();

  const { data: req, error: loadErr } = await service
    .from(TABLE)
    .select('id, user_id, store_id, notice_date, last_working_date, reason, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load request' }, { status: 500 });
  if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  if ((req.status as string) !== 'pending') {
    return NextResponse.json({ error: 'This request has already been handled' }, { status: 409 });
  }

  const userId = req.user_id as string;

  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .select('company_id')
    .eq('profile_id', userId)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to resolve employee' }, { status: 500 });
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 400 });

  const { data: offboarding, error: insertErr } = await service
    .from(OFFB_TABLE)
    .insert({
      user_id: userId,
      company_id: (emp.company_id as string | null) ?? null,
      store_id: (req.store_id as string | null) ?? null,
      kind: 'resignation',
      reason: (req.reason as string | null) ?? null,
      notice_date: (req.notice_date as string | null) ?? null,
      last_working_date: (req.last_working_date as string | null) ?? null,
      initiated_by: auth.userId,
      status: 'draft',
    })
    .select(OFFB_COLS)
    .single();
  if (insertErr) {
    if (isUniqueViolation(insertErr)) {
      return NextResponse.json(
        { error: 'this employee already has an offboarding in progress' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Failed to create offboarding' }, { status: 500 });
  }

  const offboardingId = (offboarding as unknown as { id: string }).id;

  // Claim the request atomically — if a concurrent accept beat us, roll the extra
  // offboarding back so we never leave two drafts racing.
  const { data: claimed, error: claimErr } = await service
    .from(TABLE)
    .update({
      status: 'accepted',
      offboarding_id: offboardingId,
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (claimErr || !claimed || claimed.length === 0) {
    await service.from(OFFB_TABLE).delete().eq('id', offboardingId);
    if (claimErr) {
      return NextResponse.json({ error: 'Failed to accept request' }, { status: 500 });
    }
    return NextResponse.json({ error: 'This request has already been handled' }, { status: 409 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    before: { status: 'pending' },
    after: { status: 'accepted', offboarding_id: offboardingId },
    reason: 'Resignation request accepted',
  });
  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: OFFB_TABLE,
    recordId: offboardingId,
    after: offboarding as unknown as Record<string, unknown>,
    reason: 'Offboarding initiated from resignation request',
  });

  const { assets, warnings } = await snapshotOffboardingAssets(service, offboardingId, userId);

  // Tell the employee their notice was accepted (best-effort).
  try {
    await notifyUser({
      userId,
      storeId: (req.store_id as string | null) ?? null,
      type: 'hr_resignation_result',
      title: 'ฝ่ายบุคคลรับเรื่องใบลาออกแล้ว',
      body: 'ใบลาออกของคุณได้รับการรับเรื่องแล้ว — ติดตามขั้นตอนการพ้นสภาพและการคืนทรัพย์สินได้ในหน้า "ของฉัน"',
      data: { url: '/me/offboarding' },
    });
  } catch {
    /* best-effort */
  }

  return NextResponse.json({
    data: { ...(offboarding as unknown as Record<string, unknown>), assets },
    ...(warnings.length ? { warning: warnings.join('; ') } : {}),
  });
}
