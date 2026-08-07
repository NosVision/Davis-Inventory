import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { attachFullNames } from '@/lib/hr/employee-name-map';

// GET /api/hr/announcements/[id]/receipts — receipts for an announcement, joined to
// the acknowledger's profile (display_name/username). Acknowledged rows sort first
// (newest acknowledged_at), unacknowledged (null) last.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_announcement_receipts')
    .select(
      'id, acknowledged_at, snoozed_date, user:profiles!hr_announcement_receipts_user_id_fkey(id, display_name, username)'
    )
    .eq('announcement_id', id)
    .order('acknowledged_at', { ascending: false, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Who has read the announcement, named the way the rest of HR names them (ชื่อจริง + ชื่อเล่น).
  return NextResponse.json({ data: await attachFullNames(service, data ?? []) });
}
