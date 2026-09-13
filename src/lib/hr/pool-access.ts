/**
 * May this caller act on this whole Service Charge or tip pool?
 *
 * The pool counterpart of payrun-access.ts, for the same reason: every action on a pool reaches every
 * allocation in it, so the test is "can you see all of these people", not "some of them". The read
 * side of the same rule is pool-visibility.ts.
 *
 * Returns null when the caller may proceed, or the message to refuse with.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { refuseIfConfidentialInScope } from '@/lib/hr/pay-visibility';

export type PoolKind = 'sc' | 'tip';

const ALLOCATIONS_TABLE: Record<PoolKind, string> = {
  sc: 'hr_sc_allocations',
  tip: 'hr_tip_allocations',
};

export const POOL_REFUSAL =
  'กองนี้มีพนักงานที่คุณไม่มีสิทธิ์ดูเงินเดือน — ต้องให้ผู้จัดการกลุ่มนี้ หรือผู้ที่ดูเงินเดือนได้ทุกคน เป็นผู้ทำ';

/**
 * @param poolIds every pool the action reaches — one for a pool route; all of a month's pools for the
 *   evaluation apply, which clears and re-applies across every store at once
 * @param incomingProfileIds people the request is about to write an allocation for, who may have none
 *   yet — saving the table must not be the way to start paying someone hidden
 */
export async function refusePoolIfHidden(
  service: SupabaseClient,
  userId: string,
  kind: PoolKind,
  poolIds: readonly string[],
  incomingProfileIds: readonly string[] = []
): Promise<string | null> {
  const profileIds = new Set(incomingProfileIds);
  if (poolIds.length > 0) {
    const { data, error } = await service
      .from(ALLOCATIONS_TABLE[kind])
      .select('user_id')
      .in('pool_id', [...poolIds]);
    // Fail closed: not knowing who is in the pool is not the same as nobody hidden being in it.
    if (error) return 'ตรวจสิทธิ์ดูเงินเดือนไม่สำเร็จ — ลองใหม่อีกครั้ง';
    for (const a of (data ?? []) as { user_id: string }[]) profileIds.add(a.user_id);
  }
  // An empty pool hides nothing — a freshly created pool with no allocations must stay workable.
  if (profileIds.size === 0) return null;
  const refusal = await refuseIfConfidentialInScope(service, userId, [...profileIds]);
  return refusal ? POOL_REFUSAL : null;
}
