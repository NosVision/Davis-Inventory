import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForEmployeeProfile, resolveHrScope } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isUniqueViolation } from '@/lib/hr/db-errors';
import { isCalendarDate } from '@/lib/hr/leaves';
import { snapshotOffboardingAssets } from '@/lib/hr/offboarding';
import { buildFullNameMap } from '@/lib/hr/employee-name-map';

const TABLE = 'hr_offboarding';

const COLS =
  'id, user_id, company_id, store_id, kind, reason, notice_date, last_working_date, ' +
  'severance_note, status, employee_signature_path, employee_signed_at, hr_signature_path, ' +
  'hr_signed_at, hr_signed_by, initiated_by, completed_at, created_at, updated_at, updated_by';

const EMPLOYEE_EMBED =
  'employee:profiles!hr_offboarding_user_id_fkey(id, display_name, username)';

const COMPANY_EMBED = 'company:hr_companies(id, name)';

const KINDS = ['resignation', 'termination'] as const;

// POST /api/hr/offboarding — HR initiates a resignation/termination (§J6). Derives
// company_id from the employee's hr_employees record and store_id from their first
// store membership, then snapshots the assets the person still holds into the
// asset-return checklist. The one-open partial unique index (23505) → 409 so an
// employee can never have two offboardings in progress at once.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() || null : null;
  const noticeDate = typeof body.notice_date === 'string' ? body.notice_date : null;
  const lastWorkingDate =
    typeof body.last_working_date === 'string' ? body.last_working_date : null;
  const severanceNote =
    typeof body.severance_note === 'string' ? body.severance_note.trim() || null : null;

  if (!userId) return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  if (!(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "kind must be 'resignation' or 'termination'" }, { status: 400 });
  }
  if (noticeDate !== null && !isCalendarDate(noticeDate)) {
    return NextResponse.json({ error: 'notice_date is not a valid date' }, { status: 400 });
  }
  if (lastWorkingDate !== null && !isCalendarDate(lastWorkingDate)) {
    return NextResponse.json({ error: 'last_working_date is not a valid date' }, { status: 400 });
  }

  // §P5.5: only company-wide HR or a manager whose stores include this employee may offboard them.
  const auth = await requireHrManagerForEmployeeProfile(userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();

  // The target must be a registered HR employee (keyed by profile_id) — that record
  // supplies the company_id for the offboarding.
  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .select('company_id')
    .eq('profile_id', userId)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to resolve employee' }, { status: 500 });
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 400 });
  const companyId = (emp.company_id as string | null) ?? null;

  // store_id: the employee's first store membership (nullable — a company-wide role
  // may have none).
  const { data: membership } = await service
    .from('user_stores')
    .select('store_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  const storeId = (membership?.store_id as string | undefined) ?? null;

  const { data: offboarding, error: insertErr } = await service
    .from(TABLE)
    .insert({
      user_id: userId,
      company_id: companyId,
      store_id: storeId,
      kind,
      reason,
      notice_date: noticeDate,
      last_working_date: lastWorkingDate,
      severance_note: severanceNote,
      initiated_by: auth.userId,
      status: 'draft',
    })
    .select(COLS)
    .single();
  if (insertErr) {
    if (isUniqueViolation(insertErr)) {
      return NextResponse.json(
        { error: 'this employee already has an offboarding in progress' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Failed to initiate offboarding' }, { status: 500 });
  }

  const offboardingId = (offboarding as unknown as { id: string }).id;

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: TABLE,
    recordId: offboardingId,
    after: offboarding as unknown as Record<string, unknown>,
    reason: `Offboarding initiated: ${kind}`,
  });

  // Snapshot the assets the employee currently holds into the return checklist.
  // Best-effort: a snapshot failure keeps the offboarding and returns a warning
  // rather than failing the whole initiation.
  const { assets, warnings } = await snapshotOffboardingAssets(service, offboardingId, userId);

  return NextResponse.json(
    {
      data: { ...(offboarding as unknown as Record<string, unknown>), assets },
      ...(warnings.length ? { warning: warnings.join('; ') } : {}),
    },
    { status: 201 }
  );
}

// GET /api/hr/offboarding — HR queue / history. Query: status?, company_id? (default all).
// Newest first.
export async function GET(request: NextRequest) {
  // §P5.5: company-wide HR sees the whole queue; a scoped manager sees only their stores' cases.
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const status = request.nextUrl.searchParams.get('status');
  const companyId = request.nextUrl.searchParams.get('company_id');

  const service = createServiceClient();
  let query = service.from(TABLE).select(`${COLS}, ${EMPLOYEE_EMBED}, ${COMPANY_EMBED}`);
  if (status) query = query.eq('status', status);
  if (companyId) query = query.eq('company_id', companyId);
  if (scope.storeIds) query = query.in('store_id', scope.storeIds); // scoped manager: their stores' rows only
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The embed only knows the ชื่อเล่น; an offboarding is a payroll/legal document, so the queue
  // must lead with the same ชื่อจริง /hr/payroll uses.
  const rows = (data ?? []) as unknown as { user_id: string; employee: Record<string, unknown> | null }[];
  const fullNames = await buildFullNameMap(service, rows.map((r) => r.user_id));

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      employee: r.employee ? { ...r.employee, full_name: fullNames.get(r.user_id) ?? null } : null,
    })),
  });
}
