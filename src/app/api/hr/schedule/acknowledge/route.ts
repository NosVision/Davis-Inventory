import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';

const MONTH_RE = /^\d{4}-\d{2}$/;

function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, '0')}` };
}

// POST /api/hr/schedule/acknowledge { store_id, month } — HR acknowledges a published
// roster. HR-only (requireHrManager, not the store manager): every 'submitted' row for
// the store+month → 'acknowledged' with the acknowledging HR user + timestamp.
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const month = typeof body.month === 'string' ? body.month : '';
  if (!storeId) return NextResponse.json({ error: 'store_id is required' }, { status: 400 });
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
  const { first, last } = monthRange(month);

  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_schedule')
    .update({
      status: 'acknowledged',
      acknowledged_by: auth.userId,
      acknowledged_at: new Date().toISOString(),
    })
    .eq('store_id', storeId)
    .eq('status', 'submitted')
    .gte('work_date', first)
    .lte('work_date', last)
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to acknowledge schedule' }, { status: 500 });
  return NextResponse.json({ updated: (data ?? []).length });
}
