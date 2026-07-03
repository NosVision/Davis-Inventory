import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
}
interface OtRequestRow {
  id: string;
  user_id: string;
  store_id: string;
  work_date: string;
  requested_ot_min: number;
  reason: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  decided_ot_min: number | null;
  created_at: string;
}

// GET /api/hr/ot-requests?store_id&status? — a store's OT requests for the approver
// queue (§B/§J8). Store-manager guarded.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeId = sp.get('store_id') ?? '';
  const auth = await requireStoreManager(storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const status = sp.get('status');
  if (status && !STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const service = createServiceClient();
  let query = service
    .from('hr_ot_requests')
    .select(
      'id, user_id, store_id, work_date, requested_ot_min, reason, status, decided_by, decided_at, decision_note, decided_ot_min, created_at'
    )
    .eq('store_id', storeId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load OT requests' }, { status: 500 });

  const rows = (data ?? []) as OtRequestRow[];
  const userIds = [...new Set(rows.map((r) => r.user_id))];

  const { data: profiles, error: profErr } = userIds.length
    ? await service.from('profiles').select('id, username, display_name').in('id', userIds)
    : { data: [] as ProfileRow[], error: null };
  if (profErr) return NextResponse.json({ error: 'Failed to load OT requests' }, { status: 500 });

  const nameById = new Map<string, string>();
  for (const p of (profiles ?? []) as ProfileRow[]) {
    nameById.set(p.id, p.display_name || p.username || '—');
  }

  const out = rows.map((r) => ({
    ...r,
    requester_name: nameById.get(r.user_id) ?? null,
  }));

  return NextResponse.json({ data: out });
}
