import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { computeProbationEnd } from '@/lib/hr/employees';
import { getHrPolicies } from '@/lib/hr/policy';
import { notifyUser } from '@/lib/notifications/service';

// POST /api/hr/identity-claims/[id]/decide { decision: approve|reject, note? } — HR verifies an
// employee's identity claim (owner flow 2026-07-05). APPROVE creates the hr_employees record on
// the claimant's EXISTING profiles.id, seeded from the imported sheet row (rate/start/SSO/tax,
// position matched by name when possible), adds the venue membership, audits everything and
// tells the employee. REJECT returns the name to the unclaimed pool (with the note) so the right
// person can claim it later.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: ident, error: loadErr } = await service
    .from('hr_pending_identities')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load claim' }, { status: 500 });
  if (!ident) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  if (ident.status !== 'claimed' || !ident.claimed_by) {
    return NextResponse.json({ error: 'Only a pending claim can be decided' }, { status: 409 });
  }
  const claimant = ident.claimed_by as string;

  if (decision === 'reject') {
    const { data: updated, error } = await service
      .from('hr_pending_identities')
      .update({
        status: 'unclaimed',
        claimed_by: null,
        claimed_at: null,
        reviewed_by: auth.userId,
        reviewed_at: new Date().toISOString(),
        review_note: note,
      })
      .eq('id', id)
      .eq('status', 'claimed')
      .select('id');
    if (error) return NextResponse.json({ error: 'Failed to reject' }, { status: 500 });
    if (!updated?.length) return NextResponse.json({ error: 'Claim was already decided' }, { status: 409 });

    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: 'hr_pending_identities',
      recordId: id,
      before: { status: 'claimed', claimed_by: claimant },
      after: { status: 'unclaimed', review_note: note },
      reason: note ?? 'Identity claim rejected',
    });
    try {
      await notifyUser({
        userId: claimant,
        storeId: (ident.store_id as string) ?? '',
        type: 'hr_identity_result',
        title: 'การยืนยันตัวตนไม่ผ่านการตรวจสอบ',
        body: `ชื่อ "${ident.full_name_th}" ไม่ได้รับการยืนยัน${note ? ` — ${note}` : ''} กรุณาเลือกใหม่หรือติดต่อ HR`,
        data: { url: '/me' },
      });
    } catch (e) {
      console.error('[identity-claims/decide] notify failed:', e);
    }
    return NextResponse.json({ data: { id, status: 'unclaimed' } });
  }

  // ── APPROVE ──────────────────────────────────────────────────────────────────
  // The claimant must still be unlinked (a parallel onboard/link may have happened).
  const { data: dupEmp } = await service.from('hr_employees').select('id').eq('profile_id', claimant).maybeSingle();
  if (dupEmp) {
    // release the name back rather than leaving a stuck claim
    await service
      .from('hr_pending_identities')
      .update({ status: 'unclaimed', claimed_by: null, claimed_at: null, review_note: 'claimant already linked elsewhere' })
      .eq('id', id)
      .eq('status', 'claimed');
    return NextResponse.json({ error: 'This user already has an employee record' }, { status: 409 });
  }

  // Position: match the sheet's title against hr_positions (case-insensitive exact) when possible.
  let positionId: string | null = null;
  if (ident.position_text) {
    const { data: pos } = await service
      .from('hr_positions')
      .select('id')
      .ilike('name', String(ident.position_text).trim())
      .maybeSingle();
    positionId = (pos?.id as string) ?? null;
  }

  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .insert({
      profile_id: claimant,
      company_id: ident.company_id,
      full_name: ident.full_name_th, // formal payroll name (slips/accountant review print this)
      employee_code: ident.employee_code ?? null,
      bank_name: ident.bank_name ?? null,
      bank_account_no: ident.bank_account_no ?? null,
      position_id: positionId,
      rate_satang: ident.rate_satang ?? 0,
      pay_type: ident.pay_type ?? 'full_monthly',
      start_date: ident.start_date,
      probation_end: computeProbationEnd(ident.start_date as string | null, (await getHrPolicies(service)).probation_days),
      sso_enrolled: ident.sso_enrolled ?? true,
      tax_mode: ident.tax_mode ?? 'progressive',
      status: 'active',
      notes: `นำเข้าจากชีท ${ident.sheet_ref ?? ''}${positionId ? '' : ident.position_text ? ` · ตำแหน่งในชีท: ${ident.position_text}` : ''}`.trim(),
      created_by: auth.userId,
    })
    .select('*')
    .single();
  if (empErr) {
    if ((empErr as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'This user already has an employee record' }, { status: 409 });
    }
    return NextResponse.json({ error: empErr.message }, { status: 500 });
  }

  // Back-link the legacy imported payslips (hr_imported_payslips) that were matched
  // to this pending identity, so the person's historical pay follows them into their
  // employee record. Non-fatal: a failure here must not block onboarding.
  const warnings: string[] = [];
  const { error: histErr } = await service
    .from('hr_imported_payslips')
    .update({ employee_id: emp.id })
    .eq('pending_identity_id', id);
  if (histErr) warnings.push('Historical payslips were not back-linked — link them manually');

  // Venue membership (only when missing).
  if (ident.store_id) {
    const { data: have } = await service
      .from('user_stores')
      .select('store_id')
      .eq('user_id', claimant)
      .eq('store_id', ident.store_id as string)
      .maybeSingle();
    if (!have) {
      const { error: usErr } = await service.from('user_stores').insert({ user_id: claimant, store_id: ident.store_id });
      if (usErr) warnings.push('Store assignment failed — assign the venue manually');
    }
  }

  const { data: flipped } = await service
    .from('hr_pending_identities')
    .update({
      status: 'linked',
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
      review_note: note,
      linked_employee_id: emp.id,
    })
    .eq('id', id)
    .eq('status', 'claimed')
    .select('id');
  if (!flipped?.length) {
    // lost the race after inserting the employee — roll the employee back to stay consistent
    await service.from('hr_employees').delete().eq('id', emp.id);
    return NextResponse.json({ error: 'Claim was already decided' }, { status: 409 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: 'hr_employees',
    recordId: emp.id,
    before: null,
    after: emp,
    reason: `Identity claim approved — linked "${ident.full_name_th}" (${ident.sheet_ref ?? 'sheet'}) to existing account`,
  });

  try {
    await notifyUser({
      userId: claimant,
      storeId: (ident.store_id as string) ?? '',
      type: 'hr_identity_result',
      title: 'ยืนยันตัวตนสำเร็จ',
      body: `บัญชีของคุณถูกผูกกับ "${ident.full_name_th}" เรียบร้อยแล้ว`,
      data: { url: '/me' },
    });
  } catch (e) {
    console.error('[identity-claims/decide] notify failed:', e);
  }

  return NextResponse.json({ data: { id, status: 'linked', employee_id: emp.id, warnings } });
}
