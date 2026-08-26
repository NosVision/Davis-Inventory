/**
 * May this caller act on this whole payrun?
 *
 * A payrun is one slice of one company, and every action on it — exporting the register, adding an
 * adjustment, finalizing, announcing, reopening, printing — reaches EVERY slip in it. There is no
 * partially-finalized run and no half an Excel file. So the test is not "can you see some of these
 * people" but "can you see all of them".
 *
 * Only bank-file and review-link ever asked. The other seven actions did not, which left the Excel
 * export handing the full register — gross, net, bank account — for a run whose figures the caller
 * was not allowed to read on screen, and left finalize/announce able to close and broadcast a slice
 * belonging to someone else. Every payrun action now routes through here.
 *
 * Returns null when the caller may proceed, or the message to refuse with.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { refuseIfConfidentialInScope } from '@/lib/hr/pay-visibility';

export const PAYRUN_REFUSAL =
  'งวดนี้มีพนักงานที่คุณไม่มีสิทธิ์ดูเงินเดือน — ต้องให้ผู้จัดการกลุ่มนี้ หรือผู้ที่ดูเงินเดือนได้ทุกคน เป็นผู้ทำ';

export async function refusePayrunIfHidden(
  service: SupabaseClient,
  userId: string,
  payrunId: string
): Promise<string | null> {
  const { data } = await service.from('hr_payslips').select('user_id').eq('payrun_id', payrunId);
  const profileIds = [...new Set(((data ?? []) as { user_id: string }[]).map((s) => s.user_id))];
  // An empty run hides nothing — a freshly created payrun with no slips yet must stay workable.
  if (profileIds.length === 0) return null;
  const refusal = await refuseIfConfidentialInScope(service, userId, profileIds);
  return refusal ? PAYRUN_REFUSAL : null;
}
