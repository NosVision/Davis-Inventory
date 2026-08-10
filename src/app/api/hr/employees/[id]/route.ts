import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { callerCanViewConfidentialPay, redactEmployeePay } from '@/lib/hr/pay-visibility';
import { requireHrManagerForEmployeeId } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import {
  pickEmployeeFields,
  applyPartTimeProfile,
  validatePartTimeDocs,
  computeProbationEnd,
  isPartTime,
  type EmployeeDocument,
} from '@/lib/hr/employees';

const EMPLOYEE_SELECT =
  '*, profile:profiles!hr_employees_profile_id_fkey(id, username, display_name, active, avatar_url, role), ' +
  'supervisor:profiles!hr_employees_supervisor_id_fkey(id, display_name), ' +
  'position:hr_positions(id, name), department:hr_departments(id, name), company:hr_companies(id, name)';

// Sensitive fields whose edit requires an audit reason (§B).
const SENSITIVE_KEYS = ['rate_satang', 'bank_name', 'bank_account_no', 'bank_account_name', 'sso_no', 'tax_id'];
const TERMINAL_STATUSES = ['resigned', 'terminated'];

// Roles HR may assign from the employee modal (owner ask 2026-07-10). Excludes 'owner'/'customer'.
// Owner ask 2026-07-23: HR may grant every non-owner role (the elevated owner-only gate is gone).
const ASSIGNABLE_ROLES = new Set([
  'staff', 'bar', 'head_bar', 'manager', 'technician', 'hq', 'accountant', 'hr',
  'cashier', 'housekeeping_staff', 'boh_staff', 'not_assign',
]);

// GET /api/hr/employees/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireHrManagerForEmployeeId(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_employees')
    .select(EMPLOYEE_SELECT)
    .eq('id', id)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const [redacted] = redactEmployeePay(
    [data as unknown as Record<string, unknown>],
    await callerCanViewConfidentialPay(service, auth.userId)
  );
  return NextResponse.json({ data: redacted });
}

// PUT /api/hr/employees/[id]  — partial update of writable fields + optional profile display_name.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireHrManagerForEmployeeId(id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const service = createServiceClient();
  const { data: current, error: fetchErr } = await service
    .from('hr_employees')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !current) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  }

  const picked = pickEmployeeFields(body, true);
  if (!picked.ok) return NextResponse.json({ error: 'Validation failed', fields: picked.errors }, { status: 400 });

  const fields: Record<string, unknown> = { ...picked.fields };

  // The flag is the lock itself: an HR user who cannot see confidential pay must not be able to
  // switch it off and then look. Silently dropping the field would be worse — they would think it
  // saved — so refuse the write outright.
  if ('pay_confidential' in fields && !(await callerCanViewConfidentialPay(service, auth.userId))) {
    return NextResponse.json(
      { error: 'คุณไม่มีสิทธิ์เปลี่ยนการปิดข้อมูลเงินเดือน' },
      { status: 403 }
    );
  }

  // Company changes MUST go through the dedicated transfer endpoint (mandatory reason + effective_date + audit, §A).
  if ('company_id' in fields) {
    return NextResponse.json(
      { error: 'Use POST /api/hr/employees/[id]/transfer to change company' },
      { status: 400 }
    );
  }

  // Part-time forcing on the effective (merged) pay_type; reset forced fields when leaving part-time.
  const effectivePayType = (fields.pay_type as string) ?? (current.pay_type as string);
  if (isPartTime(effectivePayType)) {
    const forced = applyPartTimeProfile({ pay_type: effectivePayType });
    fields.tax_mode = forced.tax_mode;
    fields.sso_enrolled = forced.sso_enrolled;
    fields.ot_eligible = forced.ot_eligible;
    const effectiveDocs =
      (fields.documents as EmployeeDocument[] | undefined) ?? ((current.documents as EmployeeDocument[]) ?? []);
    const docErr = validatePartTimeDocs(effectivePayType, effectiveDocs);
    if (docErr) return NextResponse.json({ error: docErr }, { status: 400 });
  } else if (isPartTime(current.pay_type as string)) {
    // transitioning part-time -> full-time: reset part-time-forced values unless caller set them explicitly
    if (!('tax_mode' in fields)) fields.tax_mode = 'progressive';
    if (!('sso_enrolled' in fields)) fields.sso_enrolled = true;
  }

  // Keep probation_end in sync with start_date (§E) unless caller supplied it explicitly.
  if ('start_date' in fields && !('probation_end' in fields)) {
    fields.probation_end = computeProbationEnd(fields.start_date as string | null);
  }

  // Terminal status requires an end_date (payroll period boundary §A + offboarding §E).
  const effectiveStatus = (fields.status as string) ?? (current.status as string);
  if (TERMINAL_STATUSES.includes(effectiveStatus)) {
    const effectiveEnd = ('end_date' in fields ? fields.end_date : current.end_date) as string | null;
    if (!effectiveEnd) {
      return NextResponse.json(
        { error: 'end_date is required when status is resigned/terminated' },
        { status: 400 }
      );
    }
  }

  // Sensitive edits require a reason (§B).
  const touchesSensitive = SENSITIVE_KEYS.some((k) => k in fields);
  if (touchesSensitive && !(typeof body.reason === 'string' && body.reason.trim())) {
    return NextResponse.json(
      { error: 'reason is required when editing rate or bank details' },
      { status: 400 }
    );
  }

  // Bank verification flag (client ask 2026-07-24 — hand-typed account numbers feed the
  // bank-transfer file, so HR must re-verify after ANY change). Changing the number or bank
  // resets the flag; an explicit tick sent WITH the change verifies the new details.
  const bankChanged =
    ('bank_account_no' in fields && fields.bank_account_no !== current.bank_account_no) ||
    ('bank_name' in fields && fields.bank_name !== current.bank_name);
  if (typeof body.bank_verified === 'boolean') {
    if (body.bank_verified !== Boolean(current.bank_verified) || bankChanged) {
      fields.bank_verified = body.bank_verified;
      fields.bank_verified_by = body.bank_verified ? auth.userId : null;
      fields.bank_verified_at = body.bank_verified ? new Date().toISOString() : null;
    }
  } else if (bankChanged) {
    fields.bank_verified = false;
    fields.bank_verified_by = null;
    fields.bank_verified_at = null;
  }

  const hasDisplayName = 'display_name' in body;

  // System role change (validated up-front so a bad/forbidden role rejects before any write).
  const roleChange = typeof body.role === 'string' && body.role ? body.role : null;
  if (roleChange && !ASSIGNABLE_ROLES.has(roleChange)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  if (Object.keys(fields).length === 0 && !hasDisplayName && !roleChange) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  let updated = current;
  if (Object.keys(fields).length > 0) {
    fields.updated_by = auth.userId;
    const { data: upd, error: updErr } = await service
      .from('hr_employees')
      .update(fields)
      .eq('id', id)
      .select('*')
      .single();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    updated = upd;
  }

  // optional profile display_name update (kept on profiles); null clears it
  if (hasDisplayName) {
    const dn = typeof body.display_name === 'string' ? body.display_name : null;
    const { error: dnErr } = await service.from('profiles').update({ display_name: dn }).eq('id', current.profile_id);
    if (dnErr) console.error('hr employee update: display_name update failed', current.profile_id, dnErr.message);
  }

  // Access follows employment status (owner 2026-07-08): the moment HR marks someone
  // resigned/terminated, deactivate their login so they're locked out immediately (the dashboard
  // layout redirects inactive profiles to /login). Re-activate if they return to active/probation.
  if ('status' in fields) {
    const shouldBeActive = !TERMINAL_STATUSES.includes(effectiveStatus);
    const { error: actErr } = await service.from('profiles').update({ active: shouldBeActive }).eq('id', current.profile_id);
    if (actErr) console.error('hr employee update: active toggle failed', current.profile_id, actErr.message);
  }

  // System role change (owner ask 2026-07-10): update the login role only when it actually differs;
  // audited separately on the profiles table.
  if (roleChange) {
    const { data: curProfile } = await service.from('profiles').select('role').eq('id', current.profile_id).maybeSingle();
    const oldRole = (curProfile?.role as string | undefined) ?? null;
    if (oldRole !== roleChange) {
      const { error: roleErr } = await service.from('profiles').update({ role: roleChange }).eq('id', current.profile_id);
      if (roleErr) return NextResponse.json({ error: roleErr.message }, { status: 500 });
      await logHrAudit(service, {
        actorId: auth.userId,
        action: 'update',
        table: 'profiles',
        recordId: current.profile_id as string,
        before: { role: oldRole },
        after: { role: roleChange },
        reason: 'system role changed by HR',
      });
    }
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: 'hr_employees',
    recordId: id,
    before: current,
    after: updated,
    reason: typeof body.reason === 'string' ? body.reason : null,
  });

  return NextResponse.json({ data: updated });
}
