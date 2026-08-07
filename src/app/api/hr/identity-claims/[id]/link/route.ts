import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { linkPendingIdentity } from '@/lib/hr/identity-link';
import { notifyUser } from '@/lib/notifications/service';

/**
 * POST /api/hr/identity-claims/[id]/link { profile_id, note? }
 *
 * HR links an imported sheet name to a login directly, without waiting for the employee to claim
 * it (owner ask 2026-08-07). The claim flow assumes the employee knows their name is sitting in
 * the import queue — 122 of them did not, so HR needs to be able to do it from their side.
 *
 * Onboarding is the SAME routine the approve path runs (lib/hr/identity-link), so a name linked
 * this way is indistinguishable from one the employee claimed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const profileId = typeof body.profile_id === 'string' ? body.profile_id.trim() : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;
  if (!profileId) return NextResponse.json({ error: 'profile_id is required' }, { status: 400 });

  const service = createServiceClient();

  const { data: ident, error: loadErr } = await service
    .from('hr_pending_identities')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load identity' }, { status: 500 });
  if (!ident) return NextResponse.json({ error: 'ไม่พบรายชื่อนี้' }, { status: 404 });
  if (ident.status === 'linked') {
    return NextResponse.json({ error: 'รายชื่อนี้ถูกผูกไปแล้ว' }, { status: 409 });
  }

  // The target must be a real, active, non-customer login. Printer accounts are store members
  // for the print server, never people.
  const { data: target } = await service
    .from('profiles')
    .select('id, username, display_name, role, active')
    .eq('id', profileId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: 'ไม่พบบัญชีผู้ใช้นี้' }, { status: 404 });
  if (target.active === false) return NextResponse.json({ error: 'บัญชีนี้ถูกปิดใช้งาน' }, { status: 400 });
  if (target.role === 'customer' || String(target.username ?? '').startsWith('printer-')) {
    return NextResponse.json({ error: 'บัญชีนี้ผูกกับพนักงานไม่ได้' }, { status: 400 });
  }

  // 'claimed' is allowed too: HR overriding a claim (e.g. the wrong person claimed it) is a
  // legitimate correction, and the audit reason records that it was HR-initiated.
  const result = await linkPendingIdentity(service, {
    identity: ident as Record<string, unknown>,
    profileId,
    actorId: auth.userId,
    fromStatuses: ['unclaimed', 'claimed'],
    note,
    reason: `HR linked "${ident.full_name_th}" (${ident.sheet_ref ?? 'sheet'}) to @${target.username} directly${note ? ` — ${note}` : ''}`,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Tell the employee — they never asked for this, so they should find out it happened.
  try {
    await notifyUser({
      userId: profileId,
      storeId: (ident.store_id as string) ?? '',
      type: 'hr_identity_result',
      title: 'บัญชีของคุณถูกผูกกับข้อมูลพนักงานแล้ว',
      body: `HR ผูกบัญชีของคุณกับ "${ident.full_name_th}" เรียบร้อยแล้ว — ตรวจสอบข้อมูลของคุณได้ที่หน้าโปรไฟล์`,
      data: { url: '/me/profile' },
    });
  } catch (e) {
    console.error('[identity-claims/link] notify failed:', e);
  }

  return NextResponse.json({
    data: { id, status: 'linked', employee_id: result.employeeId, warnings: result.warnings },
  });
}
