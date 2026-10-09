/**
 * Web Push Notification Service
 * Uses the web-push library to send PWA push notifications.
 * VAPID keys are stored in env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (email)
 */

import webpush from 'web-push';
import { createServiceClient } from '@/lib/supabase/server';
import { isWithinWorkHours } from '@/lib/notifications/work-hours';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  data?: Record<string, unknown>;
}

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  subscription: PushSubscriptionJSON;
  device_name: string | null;
  active: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// VAPID configuration
// ---------------------------------------------------------------------------

function configureVapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    console.error(
      '[WebPush] VAPID keys NOT configured! Push will NOT work.',
      `PUBLIC_KEY: ${publicKey ? 'SET' : 'MISSING'},`,
      `PRIVATE_KEY: ${privateKey ? 'SET' : 'MISSING'},`,
      `SUBJECT: ${subject ? 'SET' : 'MISSING'}`,
    );
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

// ---------------------------------------------------------------------------
// sendWebPush — Send a single Web Push notification
// ---------------------------------------------------------------------------

/**
 * Send a single Web Push notification to a specific subscription.
 *
 * @param subscription - The PushSubscription JSON object (endpoint, keys, etc.)
 * @param payload - The notification payload (title, body, icon, etc.)
 * @returns true on success, false on failure
 */
export async function sendWebPush(
  subscription: PushSubscriptionJSON,
  payload: PushPayload,
): Promise<boolean> {
  try {
    if (!configureVapid()) {
      return false;
    }

    if (!subscription.endpoint) {
      console.warn('[WebPush] Subscription has no endpoint, skipping');
      return false;
    }

    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icons/icon-192.png',
      badge: payload.badge || '/icons/icon-192.png',
      url: payload.url,
      data: payload.data,
    });

    await webpush.sendNotification(
      subscription as webpush.PushSubscription,
      pushPayload,
    );

    return true;
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number })?.statusCode;

    // 410 Gone — subscription has expired or been unsubscribed
    if (statusCode === 410 || statusCode === 404) {
      console.log(
        '[WebPush] Subscription expired (410/404), removing from database',
      );
      await removeExpiredSubscription(subscription.endpoint!);
      return false;
    }

    console.error('[WebPush] Failed to send push notification:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// sendPushToUsers — Send push to all active subscriptions of many users
// ---------------------------------------------------------------------------

/** Ids per `.in()` lookup — keeps the PostgREST URL well under its length limit. */
const LOOKUP_CHUNK = 150;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Send a push notification to every active subscription of each user.
 *
 * Preferences and subscriptions are read in one query each for the whole list. A chat message to a
 * 40-person venue room used to cost 80 lookups (one preference + one subscription read per member);
 * at the 2026-10-09 shift-start peak those were ~6.5% of all server time.
 *
 * @returns The count of successful sends across all users
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  try {
    const supabase = createServiceClient();

    const [prefResults, subResults] = await Promise.all([
      Promise.all(
        chunk(ids, LOOKUP_CHUNK).map((part) =>
          supabase.from('notification_preferences').select('user_id, notify_work_hours_only').in('user_id', part),
        ),
      ),
      Promise.all(
        chunk(ids, LOOKUP_CHUNK).map((part) =>
          supabase.from('push_subscriptions').select('*').in('user_id', part).eq('active', true),
        ),
      ),
    ]);

    // A failed chunk loses only its own recipients — the rest still get their push.
    for (const r of subResults) {
      if (r.error) console.error('[WebPush] Failed to fetch subscriptions:', r.error.message);
    }
    const subscriptions = subResults.flatMap((r) => (r.data ?? []) as PushSubscriptionRow[]);
    if (subscriptions.length === 0) return 0;

    // Quiet gate: users who opted into "only during my work hours" get web push suppressed off-shift.
    // In-app notifications are inserted separately by callers, so nothing is lost — only the popup.
    // A failed preference read falls open, like the gate itself: it must never drop a notification.
    const withSubs = new Set(subscriptions.map((s) => s.user_id));
    const quietUsers = prefResults
      .flatMap((r) => (r.data ?? []) as { user_id: string; notify_work_hours_only: boolean | null }[])
      .filter((p) => p.notify_work_hours_only === true && withSubs.has(p.user_id))
      .map((p) => p.user_id);
    const offShift = new Set<string>();
    await Promise.all(
      quietUsers.map(async (id) => {
        if (!(await isWithinWorkHours(supabase, id))) offShift.add(id);
      }),
    );

    const targets = subscriptions.filter((s) => !offShift.has(s.user_id));
    const results = await Promise.allSettled(targets.map((sub) => sendWebPush(sub.subscription, payload)));
    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value).length;

    const failures = results.length - successCount;
    if (failures > 0) {
      console.log(`[WebPush] ${failures}/${targets.length} push(es) failed for ${ids.length} user(s)`);
    }
    return successCount;
  } catch (error) {
    console.error('[WebPush] sendPushToUsers error:', error);
    return 0;
  }
}

/**
 * Send a push notification to all active subscriptions for a given user.
 *
 * @param userId - The user's ID
 * @param payload - The notification payload
 * @returns The count of successful sends
 */
export function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  return sendPushToUsers([userId], payload);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Remove an expired or unsubscribed push subscription from the database.
 */
async function removeExpiredSubscription(endpoint: string): Promise<void> {
  try {
    const supabase = createServiceClient();

    // Deactivate rather than delete, to keep audit trail
    const { error } = await supabase
      .from('push_subscriptions')
      .update({ active: false })
      .filter('subscription->>endpoint', 'eq', endpoint);

    if (error) {
      console.error(
        '[WebPush] Failed to deactivate expired subscription:',
        error.message,
      );
    }
  } catch (error) {
    console.error('[WebPush] removeExpiredSubscription error:', error);
  }
}
