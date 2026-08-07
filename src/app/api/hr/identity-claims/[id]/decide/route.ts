import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { linkPendingIdentity } from '@/lib/hr/identity-link';
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
  // Shared with the HR-initiated link route so both paths onboard identically.
  const result = await linkPendingIdentity(service, {
    identity: ident as Record<string, unknown>,
    profileId: claimant,
    actorId: auth.userId,
    fromStatuses: ['claimed'],
    note,
    reason: `Identity claim approved — linked "${ident.full_name_th}" (${ident.sheet_ref ?? 'sheet'}) to existing account`,
  });

  if (!result.ok) {
    // A claimant who already has an employee record can never be onboarded again — release the
    // name back to the pool rather than leaving a claim stuck in review.
    if (result.status === 409) {
      await service
        .from('hr_pending_identities')
        .update({ status: 'unclaimed', claimed_by: null, claimed_at: null, review_note: result.error })
        .eq('id', id)
        .eq('status', 'claimed');
    }
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

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

  return NextResponse.json({
    data: { id, status: 'linked', employee_id: result.employeeId, warnings: result.warnings },
  });
}
