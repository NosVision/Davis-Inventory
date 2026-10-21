import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { lockMonthKey } from '@/lib/hr/schedule-lock';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * POST /api/hr/schedule/lock { store_id, month: 'YYYY-MM', locked: boolean } — HR locks or unlocks
 * one store's monthly roster (HR ask 2026-10-21). Company-wide HR only: a store manager is exactly
 * who the lock holds back. Idempotent both ways. See lib/hr/schedule-lock.ts for what a lock blocks.
 */
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const month = typeof body.month === 'string' ? body.month : '';
  if (!storeId) return NextResponse.json({ error: 'store_id is required' }, { status: 400 });
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
  if (typeof body.locked !== 'boolean') {
    return NextResponse.json({ error: 'locked must be true or false' }, { status: 400 });
  }
  const locked = body.locked;
  const monthKey = lockMonthKey(month);

  const service = createServiceClient();
  if (locked) {
    const { error } = await service
      .from('hr_schedule_locks')
      .upsert(
        { store_id: storeId, month: monthKey, locked_by: auth.userId },
        { onConflict: 'store_id,month', ignoreDuplicates: true }
      );
    if (error) return NextResponse.json({ error: 'ล็อกตารางไม่สำเร็จ' }, { status: 500 });
  } else {
    const { error } = await service
      .from('hr_schedule_locks')
      .delete()
      .eq('store_id', storeId)
      .eq('month', monthKey);
    if (error) return NextResponse.json({ error: 'ปลดล็อกตารางไม่สำเร็จ' }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: locked ? 'create' : 'delete',
    table: 'hr_schedule_locks',
    recordId: storeId,
    before: locked ? null : { month },
    after: locked ? { month } : null,
    reason: locked ? `ล็อกตารางกะ ${month}` : `ปลดล็อกตารางกะ ${month}`,
  });

  return NextResponse.json({ data: { store_id: storeId, month, locked } });
}
