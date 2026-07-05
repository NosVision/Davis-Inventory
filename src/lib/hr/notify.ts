import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyUser, type NotificationType } from '@/lib/notifications/service';

// HR-side notification fan-out (§C/§Q5): find everyone who can manage HR — owners plus explicit
// `can_manage_hr` grants (mirrors canManageHr()/the DB can_manage_hr() exactly) — and push an
// in-app/PWA notification to each. Best-effort by design: a notification failure must never fail
// the business action that triggered it (callers wrap in try/catch too).
export async function notifyHrManagers(
  service: SupabaseClient,
  params: {
    storeId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    /** don't notify this user (e.g. the actor themselves) */
    excludeUserId?: string;
  }
): Promise<void> {
  const [{ data: owners }, { data: grants }] = await Promise.all([
    service.from('profiles').select('id').eq('role', 'owner').eq('active', true),
    service.from('user_permissions').select('user_id').eq('permission', 'can_manage_hr'),
  ]);

  const ids = new Set<string>();
  for (const o of owners ?? []) ids.add(o.id as string);
  for (const g of grants ?? []) ids.add(g.user_id as string);
  if (params.excludeUserId) ids.delete(params.excludeUserId);
  if (ids.size === 0) return;

  await Promise.allSettled(
    [...ids].map((userId) =>
      notifyUser({
        userId,
        storeId: params.storeId,
        type: params.type,
        title: params.title,
        body: params.body,
        data: params.data,
      })
    )
  );
}
