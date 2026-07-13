'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Bell, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { TILE_TYPES } from '@/lib/hr/ess-notif-tiles';
import { localizeNotification, type NotifTranslate } from '@/lib/notifications/localize';

// In-page banner for the /me ESS pages: when a tile shows a red badge on the hub, the badge counts
// UNREAD notifications mapped to that tile — but nothing used to show WHAT the alert was, so the
// count looked stuck and meaningless (owner report 2026-07-08). This surfaces those notifications
// at the top of the destination page and marks them read, so the user sees the message and the
// hub badge clears on the next visit. Best-effort: never blocks the page it sits on.

interface Notice {
  id: string;
  title: string;
  body: string | null;
  title_key: string | null;
  body_key: string | null;
  params: Record<string, unknown> | null;
  created_at: string;
}

function timeAgo(iso: string, isTh: boolean): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return isTh ? 'เมื่อสักครู่' : 'just now';
  if (min < 60) return isTh ? `${min} นาทีที่แล้ว` : `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return isTh ? `${hr} ชม.ที่แล้ว` : `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return isTh ? `${day} วันที่แล้ว` : `${day}d ago`;
  return new Date(iso).toLocaleDateString(isTh ? 'th-TH' : 'en-GB');
}

export function TileNotices({ tile }: { tile: string }) {
  const isTh = useLocale() === 'th';
  const t = useTranslations();
  const { user } = useAuthStore();
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    const types = TILE_TYPES[tile];
    if (!user || !types?.length) return;
    let alive = true;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from('notifications')
        .select('id, title, body, title_key, body_key, params, created_at')
        .eq('user_id', user.id)
        .eq('read', false)
        .in('type', types)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!alive) return;
      const rows = (data ?? []) as Notice[];
      if (rows.length === 0) return;
      setNotices(rows);
      // The content is now shown here → mark read so the hub tile badge clears next load.
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .in(
          'id',
          rows.map((r) => r.id)
        );
    })();
    return () => {
      alive = false;
    };
  }, [user, tile]);

  if (notices.length === 0) return null;

  const dismiss = (id: string) => setNotices((prev) => prev.filter((n) => n.id !== id));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <Bell className="h-3.5 w-3.5" /> {isTh ? 'การแจ้งเตือนใหม่' : 'New alerts'}
      </div>
      {notices.map((n) => {
        const { title, body } = localizeNotification(t as unknown as NotifTranslate, n);
        return (
        <div
          key={n.id}
          className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/15"
        >
          <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-amber-500" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
            {body && <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{body}</p>}
            <p className="mt-1 text-xs text-gray-400">{timeAgo(n.created_at, isTh)}</p>
          </div>
          <button
            type="button"
            onClick={() => dismiss(n.id)}
            aria-label={isTh ? 'ปิด' : 'Dismiss'}
            className="flex-shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-amber-100 hover:text-gray-600 dark:hover:bg-amber-900/30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        );
      })}
    </div>
  );
}
