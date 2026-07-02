import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';

// Lean list projection — never return before/after jsonb blobs here (keeps the
// history payload small; per-record diffs can be fetched separately if needed).
const LIST_SELECT =
  'id, actor_id, action, table_name, record_id, reason, created_at, ' +
  'actor:profiles!hr_audit_log_actor_id_fkey(display_name, username)';

// GET /api/hr/audit — HR change history with optional filters:
//   table (table_name), action, record_id (per-record history), limit, offset.
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = request.nextUrl.searchParams;
  const table = sp.get('table');
  const action = sp.get('action');
  const recordId = sp.get('record_id');
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 200);
  const offset = Math.max(Number(sp.get('offset')) || 0, 0);

  const service = createServiceClient();
  let query = service.from('hr_audit_log').select(LIST_SELECT, { count: 'exact' });
  if (table) query = query.eq('table_name', table);
  if (action) query = query.eq('action', action);
  if (recordId) query = query.eq('record_id', recordId);
  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [], count: count ?? 0 });
}
