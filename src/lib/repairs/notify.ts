import { createServiceClient } from '@/lib/supabase/server';
import { notifyUser, type NotificationType } from '@/lib/notifications/service';

/**
 * Notify a single user across in-app + push + LINE, looking up the user's
 * LINE id and the store's LINE token automatically (server-only).
 */
export async function notifyUserWithLine(params: {
  userId: string;
  storeId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    const svc = createServiceClient();
    const [{ data: profile }, { data: store }] = await Promise.all([
      svc.from('profiles').select('line_user_id').eq('id', params.userId).maybeSingle(),
      svc.from('stores').select('line_token').eq('id', params.storeId).maybeSingle(),
    ]);
    await notifyUser({
      ...params,
      lineUserId: profile?.line_user_id ?? undefined,
      lineToken: (store as { line_token?: string | null } | null)?.line_token ?? undefined,
    });
  } catch (error) {
    console.error('[repairs] notifyUserWithLine error:', error);
  }
}
