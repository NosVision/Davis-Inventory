'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TASK_STATUS_LABELS } from '@/lib/tasks/status';
import { todayBangkok } from '@/lib/utils/date';
import type { TaskStatus, TaskWithRelations } from '@/types/tasks';

const STATUS_ORDER: TaskStatus[] = ['scheduled', 'pending_approval', 'in_progress', 'done', 'rejected', 'cancelled'];
const STATUS_COLOR: Record<TaskStatus, string> = {
  scheduled: '#64748b',
  pending_approval: '#f59e0b',
  in_progress: '#6366f1',
  done: '#16a34a',
  rejected: '#ef4444',
  cancelled: '#94a3b8',
};

export function TabStats({ roomId }: { roomId: string }) {
  const [tasks, setTasks] = useState<TaskWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?roomId=${roomId}`);
      const data = await res.json();
      if (res.ok) setTasks(data.tasks ?? []);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    load();
  }, [load]);

  const byStatus = useMemo(
    () =>
      STATUS_ORDER.map((s) => ({
        status: s,
        label: TASK_STATUS_LABELS[s],
        value: tasks.filter((t) => t.status === s).length,
      })).filter((d) => d.value > 0),
    [tasks],
  );

  const byAssignee = useMemo(() => {
    const m = new Map<string, { name: string; value: number }>();
    for (const t of tasks) {
      for (const a of t.assignees ?? []) {
        const name = a.profile?.display_name || a.profile?.username || 'ผู้ใช้';
        const cur = m.get(a.user_id) ?? { name, value: 0 };
        cur.value += 1;
        m.set(a.user_id, cur);
      }
    }
    return [...m.values()].sort((a, b) => b.value - a.value).slice(0, 8);
  }, [tasks]);

  const today = todayBangkok();
  const overdue = useMemo(
    () => tasks.filter((t) => t.status === 'in_progress' && t.due_date && t.due_date < today).length,
    [tasks, today],
  );

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="งานทั้งหมด" value={tasks.length} />
        <Stat label="เสร็จแล้ว" value={tasks.filter((t) => t.status === 'done').length} tone="emerald" />
        <Stat label="เลยกำหนด" value={overdue} tone="red" />
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">งานตามสถานะ</p>
        {byStatus.length === 0 ? (
          <p className="text-xs text-gray-400">ยังไม่มีข้อมูล</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byStatus} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {byStatus.map((d) => (
                  <Cell key={d.status} fill={STATUS_COLOR[d.status]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">งานตามผู้รับผิดชอบ</p>
        {byAssignee.length === 0 ? (
          <p className="text-xs text-gray-400">ยังไม่มีข้อมูล</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(120, byAssignee.length * 34)}>
            <BarChart data={byAssignee} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'red' }) {
  const color =
    tone === 'emerald'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'red'
        ? 'text-red-700 dark:text-red-400'
        : 'text-gray-900 dark:text-white';
  return (
    <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}
