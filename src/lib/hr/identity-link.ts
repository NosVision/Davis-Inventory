/**
 * Turn an imported sheet name (hr_pending_identities) into a real employee record on an existing
 * login, and everything that has to happen alongside it.
 *
 * Two callers reach this:
 *   1. the employee claims their own name and HR approves — /api/hr/identity-claims/[id]/decide
 *   2. HR links the name to an account directly — /api/hr/identity-claims/[id]/link
 *
 * Both must do the SAME work (employee row seeded from the sheet, historical payslips
 * back-linked, venue membership, staged leave balances, audit), so it lives here rather than
 * being written twice and drifting.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logHrAudit } from './audit';
import { computeProbationEnd } from './employees';
import { getHrPolicies } from './policy';
import { applyPendingLeaveBalances } from './leave-balance-link';

export interface LinkIdentityParams {
  /** hr_pending_identities row, already loaded (select '*'). */
  identity: Record<string, unknown>;
  /** profiles.id to attach the employee record to. */
  profileId: string;
  actorId: string;
  /** Statuses the identity may be in for this link to be legal — guards a concurrent decision. */
  fromStatuses: readonly string[];
  /** Free-text stored on the identity and used as the audit reason. */
  reason: string;
  note?: string | null;
}

export type LinkIdentityResult =
  | { ok: true; employeeId: string; warnings: string[] }
  | { ok: false; status: number; error: string };

export async function linkPendingIdentity(
  service: SupabaseClient,
  { identity, profileId, actorId, fromStatuses, reason, note = null }: LinkIdentityParams
): Promise<LinkIdentityResult> {
  const identityId = identity.id as string;

  // One employee record per login. Checked here AND enforced by the unique index below, since
  // two HR users can be linking different sheet names to the same account at once.
  const { data: dupEmp } = await service
    .from('hr_employees')
    .select('id')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (dupEmp) {
    return { ok: false, status: 409, error: 'บัญชีนี้มีทะเบียนพนักงานอยู่แล้ว' };
  }

  // Position: match the sheet's job title against hr_positions (case-insensitive exact) when
  // possible; otherwise the title is preserved in notes for HR to assign later.
  let positionId: string | null = null;
  if (identity.position_text) {
    const { data: pos } = await service
      .from('hr_positions')
      .select('id')
      .ilike('name', String(identity.position_text).trim())
      .maybeSingle();
    positionId = (pos?.id as string) ?? null;
  }

  const policies = await getHrPolicies(service);
  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .insert({
      profile_id: profileId,
      company_id: identity.company_id,
      full_name: identity.full_name_th, // formal payroll name (slips/accountant review print this)
      employee_code: identity.employee_code ?? null,
      bank_name: identity.bank_name ?? null,
      bank_account_no: identity.bank_account_no ?? null,
      position_id: positionId,
      rate_satang: identity.rate_satang ?? 0,
      pay_type: identity.pay_type ?? 'full_monthly',
      start_date: identity.start_date,
      probation_end: computeProbationEnd(identity.start_date as string | null, policies.probation_days),
      sso_enrolled: identity.sso_enrolled ?? true,
      tax_mode: identity.tax_mode ?? 'progressive',
      status: 'active',
      notes: `นำเข้าจากชีท ${identity.sheet_ref ?? ''}${
        positionId ? '' : identity.position_text ? ` · ตำแหน่งในชีท: ${identity.position_text}` : ''
      }`.trim(),
      created_by: actorId,
    })
    .select('*')
    .single();
  if (empErr) {
    if ((empErr as { code?: string }).code === '23505') {
      return { ok: false, status: 409, error: 'บัญชีนี้มีทะเบียนพนักงานอยู่แล้ว' };
    }
    return { ok: false, status: 500, error: empErr.message };
  }

  // Back-link the legacy imported payslips matched to this pending identity, so the person's
  // historical pay follows them. Non-fatal: a failure must not block onboarding.
  const warnings: string[] = [];
  const { error: histErr } = await service
    .from('hr_imported_payslips')
    .update({ employee_id: emp.id })
    .eq('pending_identity_id', identityId);
  if (histErr) warnings.push('สลิปย้อนหลังยังไม่ถูกผูก — ผูกด้วยตัวเองภายหลัง');

  // Venue membership (only when missing).
  if (identity.store_id) {
    const { data: have } = await service
      .from('user_stores')
      .select('store_id')
      .eq('user_id', profileId)
      .eq('store_id', identity.store_id as string)
      .maybeSingle();
    if (!have) {
      const { error: usErr } = await service
        .from('user_stores')
        .insert({ user_id: profileId, store_id: identity.store_id });
      if (usErr) warnings.push('ผูกสาขาไม่สำเร็จ — กำหนดสาขาด้วยตัวเอง');
    }
  }

  // Flip the identity, guarded on the status we started from so a concurrent decision loses.
  const { data: flipped } = await service
    .from('hr_pending_identities')
    .update({
      status: 'linked',
      claimed_by: profileId,
      reviewed_by: actorId,
      reviewed_at: new Date().toISOString(),
      review_note: note,
      linked_employee_id: emp.id,
    })
    .eq('id', identityId)
    .in('status', [...fromStatuses])
    .select('id');
  if (!flipped?.length) {
    // Lost the race after inserting the employee — roll it back to stay consistent.
    await service.from('hr_employees').delete().eq('id', emp.id);
    return { ok: false, status: 409, error: 'รายชื่อนี้ถูกดำเนินการไปแล้ว' };
  }

  // Materialize staged sheet-imported leave balances (00166) — best-effort.
  try {
    await applyPendingLeaveBalances(service, {
      pendingIdentityId: identityId,
      employeeId: emp.id as string,
      companyId: (identity.company_id as string | null) ?? null,
    });
  } catch (e) {
    console.error('[identity-link] staged leave balances failed:', e);
  }

  await logHrAudit(service, {
    actorId,
    action: 'create',
    table: 'hr_employees',
    recordId: emp.id,
    before: null,
    after: emp,
    reason,
  });

  return { ok: true, employeeId: emp.id as string, warnings };
}
