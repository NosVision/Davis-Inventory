import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyUser, type NotificationType } from '@/lib/notifications/service';

// HR-side notification fan-out (§C/§Q5): find everyone who can manage HR — owners, the `hr` role,
// plus explicit `can_manage_hr` grants (mirrors canManageHr()/the DB can_manage_hr() exactly) —
// and push an in-app/PWA notification to each. Best-effort by design: a notification failure must
// never fail the business action that triggered it (callers wrap in try/catch too).
export async function notifyHrManagers(
  service: SupabaseClient,
  params: {
    storeId: string | null;
    type: NotificationType;
    title: string;
    body: string;
    /** optional i18n keys + params — forwarded so the in-app view localizes per viewer */
    titleKey?: string;
    bodyKey?: string;
    msgParams?: Record<string, unknown>;
    data?: Record<string, unknown>;
    /** don't notify this user (e.g. the actor themselves) */
    excludeUserId?: string;
  }
): Promise<void> {
  const [{ data: managers }, { data: grants }] = await Promise.all([
    service.from('profiles').select('id').in('role', ['owner', 'hr']).eq('active', true),
    service.from('user_permissions').select('user_id').eq('permission', 'can_manage_hr'),
  ]);

  const ids = new Set<string>();
  for (const m of managers ?? []) ids.add(m.id as string);
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
        titleKey: params.titleKey,
        bodyKey: params.bodyKey,
        params: params.msgParams,
        data: params.data,
      })
    )
  );
}
