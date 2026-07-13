import type { Notification } from '@/types/database';

/**
 * Minimal shape of a next-intl root translator, as used for notification content. Kept structural
 * (and callers cast their `useTranslations()` result to it) so this stays decoupled from the typed
 * message-key generics.
 */
export type NotifTranslate = {
  (key: string, values?: Record<string, string | number>): string;
  has?: (key: string) => boolean;
};

/**
 * Localize a notification for the CURRENT viewer (§notification i18n). When a `*_key` is present and
 * resolves in the active locale, it is translated with `params`; otherwise the literal title/body
 * (what was also sent to push/LINE) is used. So every legacy row and every not-yet-migrated type
 * renders exactly as before — this is purely additive.
 */
export function localizeNotification(
  t: NotifTranslate,
  n: Pick<Notification, 'title' | 'body' | 'title_key' | 'body_key' | 'params'>
): { title: string; body: string | null } {
  const values = (n.params ?? undefined) as Record<string, string | number> | undefined;

  const pick = (key: string | null | undefined, literal: string | null): string | null => {
    if (!key) return literal;
    try {
      // If the translator can tell us the key is missing, fall back rather than render a raw path.
      if (typeof t.has === 'function' && !t.has(key)) return literal;
      return t(key, values);
    } catch {
      return literal;
    }
  };

  return { title: pick(n.title_key, n.title) ?? n.title, body: pick(n.body_key, n.body) };
}
