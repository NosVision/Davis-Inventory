import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireSchedulerForScope } from '@/lib/hr/route-auth';
import { notifyHrManagers } from '@/lib/hr/notify';

const MONTH_RE = /^\d{4}-\d{2}$/;

function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, '0')}` };
}

// POST /api/hr/schedule/submit { (store_id|company_id), month } — PUBLISH the month's roster:
// every draft row → 'submitted', which is where it now STOPS. Publishing is final as of
// 2026-08-07 (owner): the venue manager who built the roster is the one accountable for it, so a
// separate HR acknowledgement added a step without adding a check. HR is told it happened.
//
// This also unsticks company-scope rosters, which could be published but never acknowledged —
// /acknowledge only ever accepted a store_id, and company rows carry store_id NULL.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const companyParam = typeof body.company_id === 'string' ? body.company_id : '';
  if (!storeId && !companyParam) {
    return NextResponse.json({ error: 'store_id or company_id is required' }, { status: 400 });
  }
  // Auth AFTER the scope is known: a venue manager may publish their own store's roster.
  const auth = await requireSchedulerForScope(companyParam ? null : storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const month = typeof body.month === 'string' ? body.month : '';
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
  const { first, last } = monthRange(month);

  const service = createServiceClient();
  let pub = service
    .from('hr_schedule')
    .update({ status: 'submitted' })
    .eq('status', 'draft')
    .gte('work_date', first)
    .lte('work_date', last);
  if (companyParam) {
    pub = pub.is('store_id', null);
    pub = companyParam === 'none' ? pub.is('company_id', null) : pub.eq('company_id', companyParam);
  } else {
    pub = pub.eq('store_id', storeId);
  }
  const { data, error } = await pub.select('id');
  if (error) return NextResponse.json({ error: 'Failed to publish schedule' }, { status: 500 });
  const updated = (data ?? []).length;

  // Tell HR a roster was published (FYI, not a task — best-effort; a notification failure must
  // never fail the publish). Skips when nothing changed (idempotent re-publish). Company-scope
  // publishes skip the notify: the publisher IS company-wide HR/HQ.
  if (updated > 0 && !companyParam) {
    try {
      const { data: store } = await service
        .from('stores')
        .select('store_name')
        .eq('id', storeId)
        .maybeSingle();
      const storeName = (store?.store_name as string) ?? '';
      await notifyHrManagers(service, {
        storeId,
        type: 'hr_schedule_published',
        title: 'ตารางกะเผยแพร่แล้ว',
        body: `เผยแพร่ตารางร้าน ${storeName} เดือน ${month} แล้ว — พนักงานเห็นแล้ว`,
        titleKey: 'notificationTemplates.schedulePublished.title',
        bodyKey: 'notificationTemplates.schedulePublished.body',
        msgParams: { store: storeName, month },
        data: { store_id: storeId, month, url: '/hr/schedule' },
        excludeUserId: auth.userId,
      });
    } catch (e) {
      console.error('[schedule/submit] notify HR failed:', e);
    }
  }

  return NextResponse.json({ updated });
}
