'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Megaphone, Loader2 } from 'lucide-react';
import { Button, EmptyState, toast } from '@/components/ui';

interface Announcement {
  id: string;
  title: string;
  body: string | null;
}

export default function MyAnnouncementsPage() {
  const t = useTranslations('hr.ess');

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/ess/announcements');
      if (!res.ok) throw new Error('load failed');
      const json = await res.json();
      setAnnouncements((json.data ?? []) as Announcement[]);
    } catch {
      toast({ type: 'error', title: t('loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  const respond = useCallback(
    async (id: string, action: 'ack' | 'snooze') => {
      setBusyId(id);
      try {
        const res = await fetch(`/api/hr/ess/announcements/${id}/${action}`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error('action failed');
        // Both outcomes remove the card for today: ack forever, snooze until
        // tomorrow. Drop it locally for instant feedback.
        setAnnouncements((prev) => prev.filter((a) => a.id !== id));
        toast({
          type: 'success',
          title: action === 'ack' ? t('annAckedOk') : t('annSnoozed'),
        });
      } catch {
        toast({ type: 'error', title: t('loadFailed') });
      } finally {
        setBusyId(null);
      }
    },
    [t]
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          {t('annTitle')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('annSubtitle')}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : announcements.length === 0 ? (
        <EmptyState icon={Megaphone} title={t('annEmpty')} />
      ) : (
        <ul className="space-y-3">
          {announcements.map((a) => {
            const busy = busyId === a.id;
            return (
              <li
                key={a.id}
                className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-start gap-2">
                  <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500 dark:text-indigo-400" />
                  <h2 className="font-semibold text-gray-900 dark:text-white">
                    {a.title}
                  </h2>
                </div>
                {a.body ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                    {a.body}
                  </p>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => respond(a.id, 'snooze')}
                  >
                    {t('annLater')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    isLoading={busy}
                    onClick={() => respond(a.id, 'ack')}
                  >
                    {t('annAck')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
