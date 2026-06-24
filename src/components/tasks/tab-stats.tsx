'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  ListTodo,
  Clock3,
  CheckCircle2,
  CalendarClock,
  AlertTriangle,
  Users,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { TASK_STATUS_LABELS } from '@/lib/tasks/status';
import { initial, avatarColor } from '@/lib/tasks/format';
import { todayBangkok } from '@/lib/utils/date';
import { cn } from '@/lib/utils/cn';
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

type Tone = 'slate' | 'indigo' | 'amber' | 'emerald' | 'sky' | 'red';
const TONES: Record<Tone, { bg: string; value: string; icon: string }> = {
  slate: { bg: 'bg-slate-50 dark:bg-slate-800/40', value: 'text-slate-700 dark:text-slate-200', icon: 'text-slate-400' },
  indigo: { bg: 'bg-indigo-50 dark:bg-indigo-900/20', value: 'text-indigo-700 dark:text-indigo-300', icon: 'text-indigo-500' },
  amber: { bg: 'bg-amber-50 dark:bg-amber-900/20', value: 'text-amber-700 dark:text-amber-300', icon: 'text-amber-500' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-900/20', value: 'text-emerald-700 dark:text-emerald-300', icon: 'text-emerald-500' },
  sky: { bg: 'bg-sky-50 dark:bg-sky-900/20', value: 'text-sky-700 dark:text-sky-300', icon: 'text-sky-500' },
  red: { bg: 'bg-red-50 dark:bg-red-900/20', value: 'text-red-700 dark:text-red-300', icon: 'text-red-500' },
};

function Kpi({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: Tone }) {
  const t = TONES[tone];
  return (
    <div className={cn('rounded-2xl border border-gray-100 p-3 dark:border-gray-700/60', t.bg)}>
      <div className="flex items-center gap-1.5">
        <Icon className={cn('h-4 w-4 shrink-0', t.icon)} />
        <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">{label}</span>
      </div>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', t.value)}>{value}</p>
    </div>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
        <Icon className="h-4 w-4 text-gray-400" /> {title}
      </div>
      {children}
    </div>
  );
}

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

  const today = todayBangkok();
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of tasks) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [tasks]);

  const total = tasks.length;
  const done = counts['done'] ?? 0;
  const overdue = useMemo(
    () => tasks.filter((t) => t.status === 'in_progress' && t.due_date && t.due_date < today).length,
    [tasks, today],
  );
  const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;

  const byStatus = useMemo(
    () =>
      STATUS_ORDER.map((s) => ({ status: s, label: TASK_STATUS_LABELS[s], value: counts[s] ?? 0 }))
        .filter((d) => d.value > 0),
    [counts],
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
    return [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [tasks]);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>;
  }

  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-gray-400">
        <BarChart3 className="h-9 w-9 text-gray-300" />
        ยังไม่มีข้อมูลสถิติในห้องนี้
      </div>
    );
  }

  const maxAssignee = Math.max(1, ...byAssignee.map((a) => a.value));

  return (
    <div className="space-y-4">
      {/* KPI cards — 2 คอลัมน์มือถือ, 3/6 จอใหญ่ */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={ListTodo} label="ทั้งหมด" value={total} tone="slate" />
        <Kpi icon={Clock3} label="กำลังทำ" value={counts['in_progress'] ?? 0} tone="indigo" />
        <Kpi icon={CalendarClock} label="รออนุมัติ" value={counts['pending_approval'] ?? 0} tone="amber" />
        <Kpi icon={CheckCircle2} label="เสร็จสิ้น" value={done} tone="emerald" />
        <Kpi icon={CalendarClock} label="รอเริ่ม" value={counts['scheduled'] ?? 0} tone="sky" />
        <Kpi icon={AlertTriangle} label="เลยกำหนด" value={overdue} tone="red" />
      </div>

      {/* อัตราเสร็จสิ้น */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold text-gray-700 dark:text-gray-200">อัตราเสร็จสิ้น</span>
          <span className="font-bold text-emerald-600 dark:text-emerald-400">{completionRate}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
            style={{ width: `${completionRate}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-gray-400">{done} จาก {total} งาน</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* โดนัทสถานะ */}
        <Panel title="งานตามสถานะ" icon={BarChart3}>
          <div className="flex items-center gap-4">
            <div className="relative h-36 w-36 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={byStatus}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="62%"
                    outerRadius="100%"
                    paddingAngle={2}
                    stroke="none"
                  >
                    {byStatus.map((d) => (
                      <Cell key={d.status} fill={STATUS_COLOR[d.status]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [`${value} งาน`, name as string]}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-gray-900 dark:text-white">{total}</span>
                <span className="text-[10px] text-gray-400">งาน</span>
              </div>
            </div>

            <ul className="min-w-0 flex-1 space-y-1.5">
              {byStatus.map((d) => (
                <li key={d.status} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLOR[d.status] }} />
                  <span className="flex-1 truncate text-gray-600 dark:text-gray-300">{d.label}</span>
                  <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{d.value}</span>
                  <span className="w-9 text-right tabular-nums text-gray-400">{Math.round((d.value / total) * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        {/* ผู้รับผิดชอบ — แถบ custom (responsive) */}
        <Panel title="งานตามผู้รับผิดชอบ" icon={Users}>
          {byAssignee.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-400">ยังไม่มีการมอบหมาย</p>
          ) : (
            <ul className="space-y-2.5">
              {byAssignee.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ backgroundColor: avatarColor(a.id) }}
                  >
                    {initial(a.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-gray-700 dark:text-gray-200">{a.name}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-gray-900 dark:text-white">{a.value}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(a.value / maxAssignee) * 100}%` }} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
