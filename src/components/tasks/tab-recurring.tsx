'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2, Repeat, Trash2 } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { RecurrenceFormModal } from './recurrence-form-modal';
import { fmtThaiDate } from '@/lib/tasks/format';
import { cn } from '@/lib/utils/cn';
import type { ProfileLite, TaskRecurrence } from '@/types/tasks';

function describeKind(r: TaskRecurrence): string {
  switch (r.kind) {
    case 'once': return `ครั้งเดียว · ${fmtThaiDate(r.start_date)}`;
    case 'day_of_month': return `ทุกวันที่ ${r.day_of_month} ของเดือน`;
    case 'every_weeks': return `ทุกๆ ${r.interval_count} สัปดาห์`;
    case 'every_months': return `ทุกๆ ${r.interval_count} เดือน`;
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
    else toast({ type: 'error', title: 'แก้ไขไม่สำเร็จ' });
  };

  const remove = async (r: TaskRecurrence) => {
    if (!confirm(`ลบงานประจำ "${r.title}"? (งานที่สร้างไปแล้วยังอยู่)`)) return;
    const res = await fetch(`/api/tasks/recurrences/${r.id}`, { method: 'DELETE' });
    if (res.ok) load();
    else toast({ type: 'error', title: 'ลบไม่สำเร็จ' });
  };

  return (
    <div className="space-y-3">
      {isOwner && (
        <div className="flex justify-end">
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreate(true)}>
            ตั้งงานประจำ
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-gray-400">
          <Repeat className="h-8 w-8 text-gray-300" />
          ยังไม่มีงานประจำ
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
              <Repeat className={cn('h-4 w-4 shrink-0', r.active ? 'text-indigo-500' : 'text-gray-300')} />
              <div className="min-w-0 flex-1">
                <p className={cn('truncate font-medium', r.active ? 'text-gray-900 dark:text-white' : 'text-gray-400 line-through')}>{r.title}</p>
                <p className="text-xs text-gray-400">{describeKind(r)}{r.remind_every_days ? ` · เตือนทุก ${r.remind_every_days} วัน` : ''}</p>
              </div>
              {isOwner && (
                <div className="flex items-center gap-1">
                  <button onClick={() => toggleActive(r)} className={cn('rounded-md px-2 py-1 text-xs font-medium', r.active ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700')}>
                    {r.active ? 'เปิด' : 'ปิด'}
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
