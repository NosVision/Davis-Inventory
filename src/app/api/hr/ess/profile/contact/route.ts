import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { logHrAudit } from '@/lib/hr/audit';

// PUT /api/hr/ess/profile/contact { phone } — self-service contact number (owner ask
// 2026-07-05). Own row only; low-risk field so it applies immediately (no HR approval,
// unlike bank/emergency-contact changes) but every change is audited.
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = typeof body.phone === 'string' ? body.phone.trim() : '';
  if (raw !== '' && !/^\+?[0-9 ()-]{6,20}$/.test(raw)) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
  }
  const phone = raw === '' ? null : raw;

  const service = createServiceClient();
  const { data: before } = await service.from('profiles').select('phone').eq('id', user.id).maybeSingle();
  const { error } = await service.from('profiles').update({ phone }).eq('id', user.id);
  if (error) return NextResponse.json({ error: 'Failed to update phone' }, { status: 500 });

  await logHrAudit(service, {
    actorId: user.id,
    action: 'update',
    table: 'profiles',
    recordId: user.id,
    before: { phone: before?.phone ?? null },
    after: { phone },
    reason: 'Self-service phone update',
  });

  return NextResponse.json({ data: { phone } });
}
