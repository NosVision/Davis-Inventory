import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_payrun_remarks';
const REMARK_MAX = 500;

// PUT /api/hr/payruns/[id]/remarks — upsert one person's free-form register remark (the legacy
// Payment file's Remark column, e.g. "หัก SV 100%"). Empty remark deletes the row. Annotation
// only — touches no money — so it stays editable after finalize. Audited.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: payrun, error: prErr } = await service
    .from('hr_payruns')
    .select('id, store_id')
    .eq('id', id)
    .maybeSingle();
  if (prErr) return NextResponse.json({ error: 'Failed to load payrun' }, { status: 500 });
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  const auth = await requireHrManagerForStore(payrun.store_id as string | null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const profileId = typeof body.profile_id === 'string' ? body.profile_id : '';
  const remark = typeof body.remark === 'string' ? body.remark.trim().slice(0, REMARK_MAX) : '';
  if (!profileId) return NextResponse.json({ error: 'profile_id is required' }, { status: 400 });

  const { data: before } = await service
    .from(TABLE)
    .select('remark')
    .eq('payrun_id', id)
    .eq('profile_id', profileId)
    .maybeSingle();

  if (!remark) {
    if (before) {
      const { error } = await service.from(TABLE).delete().eq('payrun_id', id).eq('profile_id', profileId);
      if (error) return NextResponse.json({ error: 'Failed to clear remark' }, { status: 500 });
    }
  } else {
    const { error } = await service.from(TABLE).upsert(
      { payrun_id: id, profile_id: profileId, remark, updated_by: auth.userId, updated_at: new Date().toISOString() },
      { onConflict: 'payrun_id,profile_id' }
    );
    if (error) return NextResponse.json({ error: 'Failed to save remark' }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: TABLE, recordId: `${id}:${profileId}`,
    before: { remark: before?.remark ?? null }, after: { remark: remark || null },
    reason: 'payrun remark updated',
  });
  return NextResponse.json({ data: { profile_id: profileId, remark: remark || null } });
}
