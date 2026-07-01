'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Plus, Loader2, Repeat, Trash2 } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { RecurrenceFormModal } from './recurrence-form-modal';
import { fmtThaiDate } from '@/lib/tasks/format';
import { cn } from '@/lib/utils/cn';
import type { ProfileLite, TaskRecurrence } from '@/types/tasks';

function describeKind(
  r: TaskRecurrence,
  t: (key: string, values?: Record<string, string | number>) => string,
  locale: 'th' | 'en',
): string {
  switch (r.kind) {
    case 'once': return t('recurring.onceOn', { date: fmtThaiDate(r.start_date, true, locale) });
    case 'day_of_month': return t('recurring.dayOfMonth', { day: r.day_of_month ?? 0 });
    case 'every_weeks': return t('recurring.everyWeeks', { count: r.interval_count });
    case 'every_months': return t('recurring.everyMonths', { count: r.interval_count });
    default: return '';
  }
}

export function TabRecurring({
  roomId,
  members,
  isOwner,
}: {
  roomId: string;
  members: ProfileLite[];
  isOwner: boolean;
}) {
  const t = useTranslations('tasks');
  const locale = useLocale();
  const [list, setList] = useState<TaskRecurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/recurrences?roomId=${roomId}`);
      const data = await res.json();
      if (res.ok) setList(data.recurrences ?? []);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (r: TaskRecurrence) => {
    const res = await fetch(`/api/tasks/recurrences/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !r.active }),
    });
    if (res.ok) load();
    else toast({ type: 'error', title: t('recurring.editFailed') });
  };

  const remove = async (r: TaskRecurrence) => {
    if (!confirm(t('recurring.confirmDelete', { title: r.title }))) return;
    const res = await fetch(`/api/tasks/recurrences/${r.id}`, { method: 'DELETE' });
    if (res.ok) load();
    else toast({ type: 'error', title: t('recurring.deleteFailed') });
  };

  return (
    <div className="space-y-3">
      {isOwner && (
        <div className="flex justify-end">
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
            {t('recurring.setRecurring')}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-gray-400">
          <Repeat className="h-8 w-8 text-gray-300" />
          {t('recurring.empty')}
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
              <Repeat className={cn('h-4 w-4 shrink-0', r.active ? 'text-indigo-500' : 'text-gray-300')} />
              <div className="min-w-0 flex-1">
                <p className={cn('truncate font-medium', r.active ? 'text-gray-900 dark:text-white' : 'text-gray-400 line-through')}>{r.title}</p>
                <p className="text-xs text-gray-400">{describeKind(r, t, locale as 'th' | 'en')}{r.remind_every_days ? t('recurring.remindEvery', { days: r.remind_every_days }) : ''}</p>
              </div>
              {isOwner && (
                <div className="flex items-center gap-1">
                  <button onClick={() => toggleActive(r)} className={cn('rounded-md px-2 py-1 text-xs font-medium', r.active ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700')}>
                    {r.active ? t('recurring.on') : t('recurring.off')}
                  </button>
                  <button onClick={() => remove(r)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <RecurrenceFormModal roomId={roomId} members={members} onClose={() => setShowCreate(false)} onCreated={load} />
      )}
    </div>
  );
}
