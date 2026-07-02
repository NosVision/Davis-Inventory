import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { todayBangkok } from '@/lib/utils/date';

// POST /api/hr/ess/announcements/[id]/snooze — employee self-service "Later".
// Implements ไม่รับทราบ→เด้งซ้ำวันถัดไป: stamp the receipt's snoozed_date with
// today's Bangkok business date so the announcement is hidden for the rest of
// today; the pending query re-surfaces it once todayBangkok advances past
// snoozed_date.
//
// The upsert payload intentionally omits acknowledged_at: on conflict PostgREST
// only sets the columns present in the payload, so an already-acknowledged
// receipt keeps its acknowledged_at (we never un-acknowledge by snoozing).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  // Announcement must exist and be active to be snoozed.
  const { data: announcement, error: annErr } = await service
    .from('hr_announcements')
    .select('id, active')
    .eq('id', id)
    .single();
  if (annErr || !announcement || !announcement.active) {
    return NextResponse.json({ error: 'Announcement not found or inactive' }, { status: 400 });
  }

  // Scope enforcement (mirror the ESS list route): if the announcement has store
  // rows the caller must be in at least one of them; no store rows = company-wide
  // (allowed for everyone). Prevents snoozing an out-of-scope announcement by
  // guessed id, which would pollute HR receipts.
  const { data: scopeRows, error: scopeErr } = await service
    .from('hr_announcement_stores')
    .select('store_id')
    .eq('announcement_id', id);
  if (scopeErr) {
    return NextResponse.json({ error: scopeErr.message }, { status: 500 });
  }
  if ((scopeRows ?? []).length > 0) {
    const { data: myStoreRows, error: myStoresErr } = await service
      .from('user_stores')
      .select('store_id')
      .eq('user_id', user.id);
    if (myStoresErr) {
      return NextResponse.json({ error: myStoresErr.message }, { status: 500 });
    }
    const myStoreIds = new Set((myStoreRows ?? []).map((r) => r.store_id as string));
    const inScope = (scopeRows ?? []).some((r) => myStoreIds.has(r.store_id as string));
    if (!inScope) {
      return NextResponse.json({ error: 'Not in scope' }, { status: 403 });
    }
  }

  const { error: upsertErr } = await service.from('hr_announcement_receipts').upsert(
    {
      announcement_id: id,
      user_id: user.id,
      snoozed_date: todayBangkok(),
    },
    { onConflict: 'announcement_id,user_id' }
  );
  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
