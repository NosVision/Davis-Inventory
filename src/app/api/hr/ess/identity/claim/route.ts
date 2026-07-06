import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { notifyHrManagers } from '@/lib/hr/notify';
import { logHrAudit } from '@/lib/hr/audit';

// POST /api/hr/ess/identity/claim { identity_id } — the employee says "this real name is me"
// (owner flow 2026-07-05). Guards: caller must not already be a linked employee, must not have
// another claim awaiting review (partial-unique backstop), and the name must still be unclaimed
// (compare-and-set). On success HR is notified to verify.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const identityId = typeof body.identity_id === 'string' ? body.identity_id : '';
  if (!identityId) return NextResponse.json({ error: 'identity_id is required' }, { status: 400 });

  const service = createServiceClient();

  const [{ data: emp }, { data: open }] = await Promise.all([
    service.from('hr_employees').select('id').eq('profile_id', user.id).maybeSingle(),
    service.from('hr_pending_identities').select('id').eq('claimed_by', user.id).eq('status', 'claimed').maybeSingle(),
  ]);
  if (emp) return NextResponse.json({ error: 'You are already linked as an employee' }, { status: 409 });
  if (open) return NextResponse.json({ error: 'You already have a claim awaiting review' }, { status: 409 });

  // Second factor (owner 2026-07-07): a row that carries a payroll bank account demands the FULL
  // account number back (the UI guides with bank + last 4). Only the real person knows their own
  // account; failures are audited and the name is NOT claimed. Rows without an account (some
  // kitchen staff are paid cash) skip this — HR review stays the final gate either way.
  const { data: target } = await service
    .from('hr_pending_identities')
    .select('id, status, bank_account_no')
    .eq('id', identityId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: 'Name already claimed — pick again' }, { status: 409 });
  if (target.status !== 'unclaimed') {
    return NextResponse.json({ error: 'Name already claimed — pick again' }, { status: 409 });
  }
  const expected = String(target.bank_account_no ?? '').replace(/\D/g, '');
  if (expected.length >= 4) {
    const given = String(body.bank_account_no ?? '').replace(/\D/g, '');
    if (!given) {
      return NextResponse.json({ error: 'กรุณายืนยันเลขบัญชีธนาคารของคุณ', need_bank_verify: true }, { status: 400 });
    }
    if (given !== expected) {
      await logHrAudit(service, {
        actorId: user.id,
        action: 'update',
        table: 'hr_pending_identities',
        recordId: identityId,
        before: null,
        after: { bank_verify: 'failed' },
        reason: 'Identity claim blocked — bank account number mismatch',
      });
      return NextResponse.json({ error: 'เลขบัญชีไม่ตรงกับข้อมูลในระบบ — ตรวจสอบสมุดบัญชีของคุณอีกครั้ง', need_bank_verify: true }, { status: 400 });
    }
  }

  // CAS unclaimed → claimed (the partial-unique one_open_claim index backstops a race on claimed_by).
  const { data: updated, error } = await service
    .from('hr_pending_identities')
    .update({ status: 'claimed', claimed_by: user.id, claimed_at: new Date().toISOString() })
    .eq('id', identityId)
    .eq('status', 'unclaimed')
    .select('id, full_name_th, store_id')
    .maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'You already have a claim awaiting review' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to claim' }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: 'Name already claimed — pick again' }, { status: 409 });

  await logHrAudit(service, {
    actorId: user.id,
    action: 'update',
    table: 'hr_pending_identities',
    recordId: updated.id as string,
    before: { status: 'unclaimed' },
    after: { status: 'claimed', claimed_by: user.id },
    reason: 'Employee claimed identity',
  });

  // Tell HR someone is waiting for verification (best-effort).
  try {
    const { data: prof } = await service.from('profiles').select('username, display_name').eq('id', user.id).maybeSingle();
    const who = prof?.display_name || prof?.username || '—';
    await notifyHrManagers(service, {
      storeId: (updated.store_id as string) ?? '',
      type: 'hr_identity_claim',
      title: 'พนักงานยืนยันตัวตน — รอตรวจสอบ',
      body: `${who} ระบุว่าเป็น "${updated.full_name_th}" — กรุณาตรวจสอบและอนุมัติ`,
      data: { identity_id: updated.id, url: '/hr/identity-claims' },
      excludeUserId: user.id,
    });
  } catch (e) {
    console.error('[ess/identity/claim] notify HR failed:', e);
  }

  return NextResponse.json({ data: { id: updated.id, full_name_th: updated.full_name_th, status: 'claimed' } }, { status: 201 });
}
