import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { payHiddenProfileIds } from '@/lib/hr/pay-visibility';
import { normalizeFullName } from '@/lib/hr/employee-name';

const TABLE = 'hr_profile_change_requests';
// The hr_employees columns touched by an apply — snapshotted before/after for the §B audit.
// `id` is included so the audit entry is keyed to the EMPLOYEE row (not the request), keeping
// per-employee audit-history lookups working.
const EMPLOYEE_APPLY_COLS = 'id, bank_name, bank_account_no, bank_account_name, emergency_contact, full_name';

// POST /api/hr/profile-change-requests/[id]/decide — HR approves or rejects a pending
// profile-change request (§J6). These carry bank data, so HR-only (requireHrManager) — not
// store managers. Every transition is an atomic compare-and-set (`.eq('status','pending')`,
// 0 rows → 409). Approval APPLIES the change to hr_employees; because the status flip is
// committed FIRST, an apply failure never rolls back (or hides) the approval — it returns
// a 200 + warning, and `applied` stays false for manual follow-up.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(TABLE)
    .select('id, user_id, field_key, new_value, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load change request' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Change request not found' }, { status: 404 });
  if ((row.status as string) !== 'pending') {
    return NextResponse.json({ error: 'Only pending change requests can be decided' }, { status: 409 });
  }

  // A bank-account request cannot be judged without reading the account, and the list route
  // blanks it for a caller who may not see this person's pay (pay-visibility.ts). Approving blind
  // would write a number they never saw into the bank-transfer file; rejecting blind is a
  // decision on data they were not shown. Both refused — it waits for the person who may
  // (client 2026-09-11/14/16: ทีมบัญชี's pay is closed to HR #2 everywhere).
  if ((row.field_key as string) === 'bank_account') {
    const hidden = await payHiddenProfileIds(service, auth.userId);
    if (hidden.has(row.user_id as string)) {
      return NextResponse.json(
        {
          error:
            'คุณไม่มีสิทธิ์ดูบัญชีธนาคารของพนักงานคนนี้ จึงพิจารณาคำขอนี้ไม่ได้ — ต้องให้ผู้ที่ดูเงินเดือนของคนนี้ได้เป็นผู้อนุมัติหรือปฏิเสธ',
        },
        { status: 403 }
      );
    }
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }

  const decidedAt = new Date().toISOString();

  // --- REJECT: a single atomic flip, no hr_employees effect. ---
  if (decision === 'rejected') {
    const { data: updated, error } = await service
      .from(TABLE)
      .update({
        status: 'rejected',
        approver_id: auth.userId,
        decided_at: decidedAt,
        decision_note: note,
        updated_by: auth.userId,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) return NextResponse.json({ error: 'Failed to reject change request' }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Already decided' }, { status: 409 });
    }

    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: TABLE,
      recordId: id,
      before: { status: 'pending' },
      after: { status: 'rejected', decision_note: note },
      reason: note ?? undefined,
    });

    return NextResponse.json({ data: { id, status: 'rejected' } });
  }

  // --- APPROVE: FIRST the atomic flip (source of truth), THEN best-effort apply. ---
  const { data: updated, error } = await service
    .from(TABLE)
    .update({
      status: 'approved',
      approver_id: auth.userId,
      decided_at: decidedAt,
      decision_note: note,
      updated_by: auth.userId,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to approve change request' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Already decided' }, { status: 409 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    before: { status: 'pending' },
    after: { status: 'approved', decision_note: note },
    reason: note ?? undefined,
  });

  // --- Apply the change to hr_employees. Everything below is best-effort: on failure we
  // return 200 + warning, since the approval already committed (applied stays false). ---
  const fieldKey = row.field_key as string;
  const newValue = row.new_value as Record<string, unknown> | null;
  const profileId = row.user_id as string;

  const warn = (message: string) =>
    NextResponse.json({ data: { id, status: 'approved', applied: false }, warning: message });

  if (!newValue) {
    return warn('Change approved, but the requested value was empty — apply skipped. Manual follow-up required.');
  }

  // Snapshot the employee row before + after the apply for the §B sensitive-field audit.
  const { data: before, error: beforeErr } = await service
    .from('hr_employees')
    .select(EMPLOYEE_APPLY_COLS)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (beforeErr || !before) {
    return warn('Change approved, but the employee record could not be loaded to apply it. Manual follow-up required.');
  }

  // Fail CLOSED on an unrecognized field_key rather than falling through to
  // emergency_contact (defends against a future field type being added to the DB CHECK
  // without updating this apply logic).
  let patch: Record<string, unknown>;
  if (fieldKey === 'bank_account') {
    patch = {
      bank_name: (newValue.bank_name as string) ?? null,
      bank_account_no: (newValue.bank_account_no as string) ?? null,
      bank_account_name: (newValue.bank_account_name as string) ?? null,
      // Employee-supplied bank details are unverified by definition — HR must re-check
      // against the real book/slip before the next bank-transfer export (2026-07-24).
      bank_verified: false,
      bank_verified_by: null,
      bank_verified_at: null,
    };
  } else if (fieldKey === 'emergency_contact') {
    patch = { emergency_contact: newValue };
  } else if (fieldKey === 'full_name') {
    // The legal ชื่อ-นามสกุล — this is what the next ภ.ง.ด.1 / สปส. / ใบ 50 ทวิ and bank-transfer
    // file will carry, which is exactly why it needs an HR approval rather than a self-edit.
    // One spelling however the employee typed it (client report 2026-09-07/09).
    const name = typeof newValue.full_name === 'string' ? normalizeFullName(newValue.full_name) : null;
    if (!name) {
      return warn('Change approved, but the requested name was empty — apply skipped. Manual follow-up required.');
    }
    patch = { full_name: name };
  } else {
    return warn('Change approved, but the field type is not recognized — apply skipped. Manual follow-up required.');
  }

  const { data: after, error: applyErr } = await service
    .from('hr_employees')
    .update({ ...patch, updated_by: auth.userId })
    .eq('profile_id', profileId)
    .select(EMPLOYEE_APPLY_COLS)
    .single();
  if (applyErr) {
    return warn('Change approved, but applying it to the employee record failed. Manual follow-up required.');
  }

  // Mark the request applied (best-effort — the employee row is already updated).
  const { error: appliedErr } = await service.from(TABLE).update({ applied: true }).eq('id', id);
  if (appliedErr) console.error('pcr decide: failed to set applied=true', id, appliedErr.message);

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: 'hr_employees',
    recordId: (after as { id: string }).id,
    before,
    after,
    reason: `Approved ESS ${fieldKey} change${note ? `: ${note}` : ''}`,
  });

  // The employee record IS updated; only the `applied` flag write may have failed — report
  // the true state rather than an unconditional applied:true.
  if (appliedErr) {
    return NextResponse.json({
      data: { id, status: 'approved', applied: false },
      warning:
        'Change applied to the employee record, but the request could not be flagged as applied. Manual follow-up required.',
    });
  }
  return NextResponse.json({ data: { id, status: 'approved', applied: true } });
}
