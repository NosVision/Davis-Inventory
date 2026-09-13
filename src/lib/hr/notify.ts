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
    /** don't notify these users either (e.g. everyone a request is about) */
    excludeUserIds?: readonly string[];
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
  for (const id of params.excludeUserIds ?? []) ids.delete(id);
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

/**
 * Tell the people who own a store's roster — its manager or captain, any `hr_manager_scopes` row with
 * `can_schedule` — that something waits on them. Day-off swaps are theirs to decide (client decision
 * 2026-07-20; captains 2026-08-14), yet the request used to reach HR only, so the captains it was
 * built for never heard of it (owner report 2026-09-13).
 *
 * A store with nobody else to decide — no scope rows, or only the people the request is about —
 * falls back to company HR, so a request never waits on no one. Returns who was told.
 */
export async function notifyStoreSchedulers(
  service: SupabaseClient,
  params: {
    storeId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    /** where a store manager / captain lands */
    storeUrl: string;
    /** where HR lands when it is the fallback */
    hrUrl: string;
    /** the people the request is about — never asked to decide it */
    excludeUserIds?: readonly string[];
  }
): Promise<'store' | 'hr'> {
  const { data: scopes, error } = await service
    .from('hr_manager_scopes')
    .select('user_id')
    .eq('store_id', params.storeId)
    .eq('can_schedule', true);
  const excluded = new Set(params.excludeUserIds ?? []);
  const ids = [...new Set(((scopes ?? []) as { user_id: string }[]).map((s) => s.user_id))].filter(
    (id) => !excluded.has(id)
  );

  // Not knowing who runs the store is treated like nobody running it: HR hears about it instead.
  if (error || ids.length === 0) {
    await notifyHrManagers(service, {
      storeId: params.storeId,
      type: params.type,
      title: params.title,
      body: params.body,
      data: { ...params.data, url: params.hrUrl },
      excludeUserIds: params.excludeUserIds,
    });
    return 'hr';
  }

  await Promise.allSettled(
    ids.map((userId) =>
      notifyUser({
        userId,
        storeId: params.storeId,
        type: params.type,
        title: params.title,
        body: params.body,
        data: { ...params.data, url: params.storeUrl },
      })
    )
  );
  return 'store';
}
