import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';

const MONTH_RE = /^\d{4}-\d{2}$/;

function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, '0')}` };
}

// POST /api/hr/schedule/submit { store_id, month } — the store manager publishes the
// month's roster: every draft row → 'submitted' (now visible to employees in ESS).
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const auth = await requireStoreManager(storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const month = typeof body.month === 'string' ? body.month : '';
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
  const { first, last } = monthRange(month);

  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_schedule')
    .update({ status: 'submitted' })
    .eq('store_id', storeId)
    .eq('status', 'draft')
    .gte('work_date', first)
    .lte('work_date', last)
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to submit schedule' }, { status: 500 });
  return NextResponse.json({ updated: (data ?? []).length });
}
