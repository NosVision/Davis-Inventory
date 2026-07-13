import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireScheduler } from '@/lib/hr/route-auth';
import { notifyHrManagers } from '@/lib/hr/notify';

const MONTH_RE = /^\d{4}-\d{2}$/;

function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, '0')}` };
}

// POST /api/hr/schedule/submit { store_id, month } — HQ/HR PUBLISHES the month's roster: every
// draft row → 'submitted' (now visible to employees in ESS), and HR is notified to acknowledge.
export async function POST(request: NextRequest) {
  const auth = await requireScheduler();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  if (!storeId) return NextResponse.json({ error: 'store_id is required' }, { status: 400 });
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
  if (error) return NextResponse.json({ error: 'Failed to publish schedule' }, { status: 500 });
  const updated = (data ?? []).length;

  // Tell HR a roster was published and awaits their acknowledgment (best-effort — a notification
  // failure must never fail the publish). Skips when nothing changed (idempotent re-publish).
  if (updated > 0) {
    try {
      const { data: store } = await service
        .from('stores')
        .select('store_name')
        .eq('id', storeId)
        .maybeSingle();
      await notifyHrManagers(service, {
        storeId,
        type: 'hr_schedule_published',
        title: 'ตารางกะเผยแพร่แล้ว — รอรับทราบ',
        body: `เผยแพร่ตารางร้าน ${(store?.store_name as string) ?? ''} เดือน ${month} แล้ว — กรุณารับทราบ`,
        data: { store_id: storeId, month, url: '/hr/schedule' },
        excludeUserId: auth.userId,
      });
    } catch (e) {
      console.error('[schedule/submit] notify HR failed:', e);
    }
  }

  return NextResponse.json({ updated });
}
