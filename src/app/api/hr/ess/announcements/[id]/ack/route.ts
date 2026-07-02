import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// POST /api/hr/ess/announcements/[id]/ack — employee self-service acknowledge.
// Any authenticated user may acknowledge. Records (or updates) a single receipt
// per (announcement, user) with acknowledged_at set and snoozed_date cleared so
// the announcement stops being "pending" for this user permanently.
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

  // Announcement must exist and be active to be acknowledged.
  const { data: announcement, error: annErr } = await service
    .from('hr_announcements')
    .select('id, active')
    .eq('id', id)
    .single();
  if (annErr || !announcement || !announcement.active) {
    return NextResponse.json({ error: 'Announcement not found or inactive' }, { status: 400 });
  }

  const { error: upsertErr } = await service.from('hr_announcement_receipts').upsert(
    {
      announcement_id: id,
      user_id: user.id,
      acknowledged_at: new Date().toISOString(),
      snoozed_date: null,
    },
    { onConflict: 'announcement_id,user_id' }
  );
  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
