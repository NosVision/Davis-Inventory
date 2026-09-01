import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { describeQuotaExceeded, type QuotaBreakdown } from '@/lib/hr/leaves';
import { loadLeaveQuotaContext } from '@/lib/hr/leave-quota';
import {
  requireHrManager,
  requireStoreManager,
  requireHrManagerForEmployeeProfile,
} from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { countLeaveDays, isCalendarDate } from '@/lib/hr/leaves';
import { buildFullNameMap } from '@/lib/hr/employee-name-map';

const TABLE = 'hr_leaves';
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

const COLS =
  'id, user_id, store_id, company_id, leave_type_id, from_date, to_date, days, reason, ' +
  'cert_path, status, approver_id, decided_at, decision_note, created_at, updated_at';

const SELECT =
  `${COLS}, ` +
  'requester:profiles!hr_leaves_user_id_fkey(id, display_name, username), ' +
  'leave_type:hr_leave_types(code, name_th, name_en)';

// GET /api/hr/leaves?store_id&status? — the approval queue (§E).
// With store_id: store-manager guarded, scoped to that store.
// Without store_id: company-wide HR view (requires can_manage_hr).
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeId = sp.get('store_id') ?? '';

  const auth = storeId ? await requireStoreManager(storeId) : await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const status = sp.get('status') ?? 'pending';
  if (status !== 'all' && !STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const service = createServiceClient();
  let query = service.from(TABLE).select(SELECT);
  if (storeId) query = query.eq('store_id', storeId);
  if (status !== 'all') query = query.eq('status', status);

  // Pending: soonest-starting first (act on the nearest leave). Otherwise newest first.
  query =
    status === 'pending'
      ? query.order('from_date', { ascending: true })
      : query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to load leaves' }, { status: 500 });

  // hr_leaves keys on profiles, which only knows the ชื่อเล่น. Attach the payroll ชื่อจริง so the
  // queue names people the same way /hr/payroll does.
  const rows = (data ?? []) as unknown as { user_id: string; requester: Record<string, unknown> | null }[];
  const fullNames = await buildFullNameMap(service, rows.map((r) => r.user_id));

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      requester: r.requester ? { ...r.requester, full_name: fullNames.get(r.user_id) ?? null } : null,
    })),
  });
}

// POST /api/hr/leaves — HR records a leave ON BEHALF of an employee, already approved
// (owner ask 2026-07-10). This is the manual/backdated path used from the timesheet
// day-edit modal so a scheduled-but-absent day can be reclassified as a proper leave
// (which then "covers" the day in payroll instead of docking it as an unauthorised
// absence). A reason is always required; every write is audited.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = typeof body.user_id === 'string' ? body.user_id : '';
  const storeId = typeof body.store_id === 'string' && body.store_id ? body.store_id : null;
  const leaveTypeId = typeof body.leave_type_id === 'string' ? body.leave_type_id : '';
  const fromDate = typeof body.from_date === 'string' ? body.from_date : '';
  const toDate = typeof body.to_date === 'string' ? body.to_date : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  // Set by the confirm dialog after the caller has been shown the numbers (owner ask 2026-08-27):
  // HR carries the authority, so an over-quota entry is a decision to record, not a wall. Forcing
  // a hard block here would just push them to edit the person's quota instead, which corrupts it.
  const overrideQuota = body.override_quota === true;
  const overrideReason =
    typeof body.override_reason === 'string' ? body.override_reason.trim() : '';

  if (!userId || !leaveTypeId) {
    return NextResponse.json({ error: 'user_id and leave_type_id are required' }, { status: 400 });
  }
  if (!isCalendarDate(fromDate) || !isCalendarDate(toDate)) {
    return NextResponse.json({ error: 'Invalid from_date or to_date' }, { status: 400 });
  }
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'to_date must be on or after from_date' }, { status: 400 });
  }
  // A reason is always required for an HR-entered leave (owner ask 2026-07-10).
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
  }

  // §P5.5: company-wide HR, or a manager whose stores include this employee.
  const auth = await requireHrManagerForEmployeeProfile(userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();

  // The employee's hr_employees row fixes the company (leaves are company-scoped).
  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .select('id, company_id')
    .eq('profile_id', userId)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to load employee' }, { status: 500 });
  if (!emp || !emp.company_id) {
    return NextResponse.json({ error: 'Employee is not registered (no company)' }, { status: 400 });
  }
  const companyId = emp.company_id as string;

  // Validate the leave type belongs to this company (or is a shared type).
  const { data: lt, error: ltErr } = await service
    .from('hr_leave_types')
    .select('id, company_id, name_th, annual_quota_days')
    .eq('id', leaveTypeId)
    .maybeSingle();
  if (ltErr) return NextResponse.json({ error: 'Failed to load leave type' }, { status: 500 });
  if (!lt) return NextResponse.json({ error: 'Leave type not found' }, { status: 400 });
  if (lt.company_id != null && lt.company_id !== companyId) {
    return NextResponse.json({ error: 'Leave type not available for this company' }, { status: 400 });
  }

  // Raw calendar-day count. Roster day-offs are excluded at approval time (see the decide
  // route), because a leave filed for future dates has no roster row to check yet.
  const days = countLeaveDays(fromDate, toDate);
  if (days <= 0) {
    return NextResponse.json({ error: 'Leave range contains no working days' }, { status: 400 });
  }

  // The annual quota, counting requests still in the queue as well as approved ones. HR's own
  // form used to skip this check entirely, so the same request refused from /me/leaves went
  // straight through from here (owner report 2026-08-27).
  const year = Number(fromDate.slice(0, 4));
  const quotaCtx = await loadLeaveQuotaContext(service, {
    employeeId: emp.id as string,
    profileId: userId,
    leaveTypeId,
    typeQuotaDays: lt.annual_quota_days == null ? null : Number(lt.annual_quota_days),
    year,
  });
  let quotaOverride: QuotaBreakdown | null = null;
  if (quotaCtx.effectiveQuota != null) {
    const pendingDays = quotaCtx.pending.reduce((sum, r) => sum + r.days, 0);
    const total =
      Math.round((quotaCtx.approved + quotaCtx.usedBeforeSystem + pendingDays + days) * 10) / 10;
    if (total > quotaCtx.effectiveQuota) {
      const breakdown: QuotaBreakdown = {
        quota: quotaCtx.effectiveQuota,
        approved: quotaCtx.approved,
        carried: quotaCtx.usedBeforeSystem,
        pending: Math.round(pendingDays * 10) / 10,
        requested: days,
        over: Math.round((total - quotaCtx.effectiveQuota) * 10) / 10,
        pendingRefs: quotaCtx.pending,
      };
      // 409 rather than 400: this is not malformed input, it is a decision the caller can take.
      if (!overrideQuota) {
        return NextResponse.json(
          {
            error: describeQuotaExceeded(lt.name_th as string, breakdown),
            code: 'quota_exceeded',
            quota: breakdown,
          },
          { status: 409 }
        );
      }
      if (!overrideReason) {
        return NextResponse.json(
          { error: 'ต้องระบุเหตุผลที่ให้เกินโควตา', code: 'override_reason_required' },
          { status: 400 }
        );
      }
      quotaOverride = breakdown;
    }
  }

  const nowIso = new Date().toISOString();
  const { data: inserted, error: insErr } = await service
    .from(TABLE)
    .insert({
      user_id: userId,
      store_id: storeId,
      company_id: companyId,
      leave_type_id: leaveTypeId,
      from_date: fromDate,
      to_date: toDate,
      days,
      reason,
      status: 'approved', // HR-entered → approved on the spot
      approver_id: auth.userId,
      decided_at: nowIso,
      decision_note: 'HR-entered leave',
    })
    .select(SELECT)
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const insertedRow = inserted as unknown as { id: string } & Record<string, unknown>;
  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: TABLE,
    recordId: insertedRow.id,
    before: null,
    // The override is recorded on the row itself, not only in the reason text, so "who was let
    // past their quota, by how much, and why" is answerable without parsing prose.
    after: quotaOverride ? { ...insertedRow, quota_override: quotaOverride } : insertedRow,
    reason: quotaOverride
      ? `${reason} · เกินโควตา ${quotaOverride.over} วัน — เหตุผล: ${overrideReason}`
      : reason,
  });

  return NextResponse.json(
    { data: inserted, ...(quotaOverride ? { quota_override: quotaOverride } : {}) },
    { status: 201 }
  );
}
