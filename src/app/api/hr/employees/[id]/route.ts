import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  EMPLOYEE_PAY_COLUMNS,
  callerCanViewConfidentialPay,
  isPayHiddenFrom,
  loadPayVisibility,
  redactEmployeePay,
} from '@/lib/hr/pay-visibility';
import { requireHrManager, requireHrManagerForEmployeeId } from '@/lib/hr/route-auth';
import { findDeleteBlockers, DELETE_BLOCKER_TH, type DeleteBlocker } from '@/lib/hr/employee-delete';
import { logHrAudit } from '@/lib/hr/audit';
import { normalizeFullName } from '@/lib/hr/employee-name';
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

// Sensitive fields whose edit requires an audit reason (§B). The employee form only posts these
// when HR actually changed them, which is what makes their presence a real attempt (see PUT).
const SENSITIVE_KEYS = ['rate_satang', 'bank_name', 'bank_account_no', 'bank_account_name', 'sso_no', 'tax_id'];
const TERMINAL_STATUSES = ['resigned', 'terminated'];
const PAY_EDIT_FORBIDDEN =
  'ไม่มีสิทธิ์แก้ข้อมูลเงินเดือนของพนักงานคนนี้ — บันทึกข้อมูลอื่นแล้ว แต่ไม่ได้บันทึกเงินเดือน/บัญชีธนาคาร/เลขประกันสังคม/เลขผู้เสียภาษี ต้องให้ผู้ที่ดูเงินเดือนของคนนี้ได้เป็นผู้แก้';

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
    await loadPayVisibility(service, auth.userId)
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

  // One spelling of the legal name whichever screen typed it (client report 2026-09-07/09).
  if (typeof fields.full_name === 'string') fields.full_name = normalizeFullName(fields.full_name);

  // The flag is the lock itself: an HR user who cannot see confidential pay must not be able to
  // switch it off and then look. Silently dropping a real attempt would be worse — they would
  // think it saved — so that still refuses the write outright.
  //
  // But the guard used to fire on the field being PRESENT, and the employee form posts the whole
  // record on every save, flag included and usually unchanged. So an HR user without the grant
  // could not save any edit to anyone: changing a payroll group or a phone number came back as
  // "คุณไม่มีสิทธิ์เปลี่ยนการปิดข้อมูลเงินเดือน", about a field they never touched
  // (owner report 2026-08-14). Only an actual change is an attempt to change anything.
  if ('pay_confidential' in fields) {
    const changing = Boolean(fields.pay_confidential) !== Boolean(current.pay_confidential);
    if (!changing) {
      delete fields.pay_confidential;
    } else if (!(await callerCanViewConfidentialPay(service, auth.userId))) {
      return NextResponse.json(
        { error: 'คุณไม่มีสิทธิ์เปลี่ยนการปิดข้อมูลเงินเดือน' },
        { status: 403 }
      );
    }
  }

  // The same lock, seen from the write side (§00195). An HR user who cannot see this person's pay
  // must not be able to move them OUT of the group that hides them — the figures would be readable
  // a moment later. Decided on where the employee is NOW (`current`), not where the request wants
  // them to be.
  const visibility = await loadPayVisibility(service, auth.userId);
  const payHidden = isPayHiddenFrom(
    current as { pay_confidential: boolean; payroll_group_id: string | null },
    visibility
  );
  // Pay fields this caller tried to change and was refused — reported back, never silently lost.
  const droppedPayKeys: string[] = [];
  if (payHidden) {
    if (
      'payroll_group_id' in fields &&
      (fields.payroll_group_id ?? null) !== (current.payroll_group_id ?? null)
    ) {
      return NextResponse.json(
        { error: 'คุณไม่มีสิทธิ์ย้ายกลุ่มเงินเดือนของพนักงานคนนี้' },
        { status: 403 }
      );
    }
    // The employee form posts every field on every save, and this caller received EVERY pay
    // column blanked by redactEmployeePay — so tax_mode comes back as the form's default,
    // pvd_* as 0/false and bank_verified as false. Writing those back would erase a salary, a
    // tax mode and a PVD enrolment they were never allowed to read (the wider redaction of
    // 2026-09-19 made this bite for more than rate/bank). Drop them rather than refuse, so
    // editing a phone number still works — but a value that DIFFERS from what is stored, on a
    // key the form only sends when HR really typed it, was an attempt to set the salary, and
    // HR must hear that it did not save (silently dropping it read as "saved" until 2026-09-19).
    for (const key of EMPLOYEE_PAY_COLUMNS) {
      if (!(key in fields)) continue;
      if (SENSITIVE_KEYS.includes(key) && fields[key] !== (current[key] ?? null)) droppedPayKeys.push(key);
      delete fields[key];
    }
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
  // A caller who may not see the account cannot verify it either — the form posts the tick on every
  // save, and for them it is the blank the redaction sent, not a decision.
  const bankChanged =
    ('bank_account_no' in fields && fields.bank_account_no !== current.bank_account_no) ||
    ('bank_name' in fields && fields.bank_name !== current.bank_name);
  if (!payHidden && typeof body.bank_verified === 'boolean') {
    if (body.bank_verified !== Boolean(current.bank_verified) || bankChanged) {
      fields.bank_verified = body.bank_verified;
      fields.bank_verified_by = body.bank_verified ? auth.userId : null;
      fields.bank_verified_at = body.bank_verified ? new Date().toISOString() : null;
    }
  } else if (!payHidden && bankChanged) {
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
    // Only pay fields were sent and every one was refused: nothing to save, and a 200 would lie.
    if (droppedPayKeys.length > 0) {
      return NextResponse.json({ error: PAY_EDIT_FORBIDDEN, dropped: droppedPayKeys }, { status: 403 });
    }
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
  let displayNameFailed = false;
  if (hasDisplayName) {
    const dn = typeof body.display_name === 'string' ? body.display_name : null;
    const { error: dnErr } = await service.from('profiles').update({ display_name: dn }).eq('id', current.profile_id);
    if (dnErr) {
      console.error('hr employee update: display_name update failed', current.profile_id, dnErr.message);
      displayNameFailed = true;
    }
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

  // Finish status synchronization and audit for the committed employee edit before reporting
  // a separate profile-name failure; never skip offboarding because a nickname write failed.
  if (displayNameFailed) {
    return NextResponse.json({ error: 'บันทึกข้อมูลพนักงานแล้ว แต่บันทึกชื่อแสดงผลไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 });
  }
  // The GET is redacted; the PUT handed the same caller the full row back after every save
  // (found 2026-09-19). Same visibility, same redaction — plus the dropped keys, so the form
  // can say the salary did NOT save instead of showing a green toast.
  const [redacted] = redactEmployeePay([updated as unknown as Record<string, unknown>], visibility);
  return NextResponse.json(
    droppedPayKeys.length > 0
      ? { data: redacted, warning: { dropped: droppedPayKeys, message: PAY_EDIT_FORBIDDEN } }
      : { data: redacted }
  );
}

// DELETE /api/hr/employees/[id] — remove a duplicate record that never did anything (client report
// 2026-10-08). Company-wide HR only, and only once the login is disabled and the record has no
// history at all (lib/hr/employee-delete.ts); everything else is resigned, never erased. The login
// itself is left disabled, not deleted — profiles carry audit and authorship references.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  const { data: current, error: fetchErr } = await service
    .from('hr_employees')
    .select('*, profile:profiles!hr_employees_profile_id_fkey(username, active)')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: 'Failed to load employee' }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const profile = current.profile as { username: string | null; active: boolean | null } | null;
  let blockers: DeleteBlocker[];
  try {
    blockers = await findDeleteBlockers(service, {
      id,
      profile_id: current.profile_id as string,
      profile_active: profile?.active ?? null,
    });
  } catch (e) {
    console.error('hr employee delete: blocker check failed', id, e);
    return NextResponse.json({ error: 'Failed to check employee history' }, { status: 500 });
  }
  if (blockers.length > 0) {
    return NextResponse.json(
      {
        error: `ลบไม่ได้ — ${blockers.map((b) => DELETE_BLOCKER_TH[b]).join(', ')}`,
        blockers,
      },
      { status: 409 }
    );
  }

  const { error: delErr } = await service.from('hr_employees').delete().eq('id', id);
  if (delErr) return NextResponse.json({ error: 'Failed to delete employee' }, { status: 500 });

  const before = Object.fromEntries(Object.entries(current).filter(([k]) => k !== 'profile'));
  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'delete',
    table: 'hr_employees',
    recordId: id,
    before,
    after: null,
    reason: `Duplicate record removed (login @${profile?.username ?? current.profile_id} already disabled)`,
  });

  return NextResponse.json({ data: { id, deleted: true } });
}
